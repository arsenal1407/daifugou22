const socket = io();

const RULE_LABELS = {
  quadRevolution: '通常革命(同ランク4枚以上)',
  sequence: '階段(3枚以上の同スート連番)',
  sequenceRevolution: '階段革命(階段5枚以上で発動)',
  jackBack: '11バック(ジャックで場の強弱反転)',
  eightCut: '8切り(8を出すと場が流れる)',
  sevenGive: '7渡し(7を出した数だけ札を渡す)',
  tenDiscard: '10捨て(10を出した数だけ札を捨てる)',
  spade3Return: 'スペード3返し(ジョーカーをスペード3で返せる)',
  classSystem: '階級制(ラウンド間でカード交換)',
};

let myId = null;
let joined = false;
let selectedCardIds = new Set();
let selectedGiveTarget = null;
let lastState = null;

const el = (id) => document.getElementById(id);

function showToast(message) {
  const t = el('toast');
  t.textContent = message;
  t.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add('hidden'), 3200);
}

el('joinBtn').addEventListener('click', () => {
  const name = el('nameInput').value.trim();
  const passphrase = el('passInput').value.trim();
  if (!name || !passphrase) {
    showToast('名前と合言葉を入力してください');
    return;
  }
  socket.emit('createOrJoin', { name, passphrase });
});

el('startGameBtn').addEventListener('click', () => socket.emit('startGame'));
el('nextRoundBtn').addEventListener('click', () => socket.emit('startNextRound'));
el('playBtn').addEventListener('click', () => {
  if (selectedCardIds.size === 0) {
    showToast('出すカードを選んでください');
    return;
  }
  socket.emit('playCards', { cardIds: Array.from(selectedCardIds) });
  selectedCardIds.clear();
});
el('passBtn').addEventListener('click', () => socket.emit('pass'));

socket.on('error', (e) => showToast(e.message));

socket.on('state', (state) => {
  myId = state.myId;
  joined = true;
  lastState = state;
  render(state);
});

function suitInfo(card) {
  if (card.joker) return { symbol: '🃏', red: false, label: 'JOKER' };
  const map = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const red = card.suit === 'H' || card.suit === 'D';
  return { symbol: map[card.suit], red, label: card.rank };
}

function cardEl(card, { selectable, selected, onClick } = {}) {
  const info = suitInfo(card);
  const div = document.createElement('div');
  div.className = 'playing-card' + (info.red ? ' red' : '') + (card.joker ? ' joker' : '') + (selected ? ' selected' : '') + (selectable ? '' : ' static');
  div.innerHTML = `<div>${card.joker ? '' : info.label}</div><div class="suit">${info.symbol}</div>`;
  if (selectable) div.addEventListener('click', onClick);
  return div;
}

function sortHand(hand) {
  const order = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  return hand.slice().sort((a, b) => {
    const sa = a.joker ? 999 : order.indexOf(a.rank);
    const sb = b.joker ? 999 : order.indexOf(b.rank);
    return sa - sb;
  });
}

function render(state) {
  const showGame = state.started || (state.pendingExchanges && state.pendingExchanges.length > 0);

  el('lobbyScreen').classList.add('hidden');
  el('waitingScreen').classList.toggle('hidden', showGame);
  el('gameScreen').classList.toggle('hidden', !showGame);

  if (!showGame) {
    renderWaiting(state);
  } else {
    renderGame(state);
  }
}

function renderWaiting(state) {
  el('roomCodeLabel').textContent = state.code;
  el('playerCount').textContent = state.players.length;

  const list = el('playerList');
  list.innerHTML = '';
  state.players.forEach((p) => {
    const li = document.createElement('li');
    const tags = [];
    if (p.id === state.hostId) tags.push('ホスト');
    if (!p.connected) tags.push('切断');
    li.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="tag">${tags.join(' / ')}</span>`;
    list.appendChild(li);
  });

  const isHost = state.hostId === myId;
  const noResultYet = !state.lastRoundResult;

  el('hostControls').classList.toggle('hidden', !(isHost && noResultYet));
  el('nonHostNote').classList.toggle('hidden', !(!isHost && noResultYet));

  if (isHost && noResultYet) {
    renderRulesForm(state.rules);
  }

  el('roundResultPanel').classList.toggle('hidden', noResultYet);
  if (!noResultYet) {
    const rl = el('roundResultList');
    rl.innerHTML = '';
    state.lastRoundResult.forEach((r) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${escapeHtml(r.name)}</span><span>${r.rankTitle}</span>`;
      rl.appendChild(li);
    });
    el('nextRoundBtn').classList.toggle('hidden', !isHost);
    el('nextRoundNote').classList.toggle('hidden', isHost);
  }
}

function renderRulesForm(rules) {
  const form = el('rulesForm');
  form.innerHTML = '';
  Object.keys(RULE_LABELS).forEach((key) => {
    const wrap = document.createElement('label');
    wrap.className = 'rule-item';
    const checked = rules[key] ? 'checked' : '';
    wrap.innerHTML = `<input type="checkbox" data-rule="${key}" ${checked} /> ${RULE_LABELS[key]}`;
    form.appendChild(wrap);
  });
  form.querySelectorAll('input[data-rule]').forEach((input) => {
    input.addEventListener('change', () => {
      const updated = {};
      form.querySelectorAll('input[data-rule]').forEach((i) => {
        updated[i.dataset.rule] = i.checked;
      });
      socket.emit('updateRules', updated);
    });
  });
}

function renderGame(state) {
  // ステータスフラグ
  const flags = [];
  if (state.revolutionActive) flags.push('革命中');
  if (state.elevenBackActive) flags.push('11バック中');
  el('statusFlags').innerHTML = flags.map((f) => `<span>${f}</span>`).join('');

  const myTurn = state.turnPlayerId === myId && !state.pending && (!state.pendingExchanges || state.pendingExchanges.length === 0);
  const turnPlayer = state.players.find((p) => p.id === state.turnPlayerId);
  el('turnIndicator').textContent = state.pending || (state.pendingExchanges && state.pendingExchanges.length > 0)
    ? ''
    : (myTurn ? 'あなたの番です' : (turnPlayer ? `${turnPlayer.name} の番です` : ''));

  // 対戦相手
  const opp = el('opponents');
  opp.innerHTML = '';
  state.players.filter((p) => p.id !== myId).forEach((p) => {
    const div = document.createElement('div');
    div.className = 'opponent' + (p.id === state.turnPlayerId ? ' active-turn' : '') + (p.finished ? ' finished' : '');
    div.innerHTML = `<div class="name">${escapeHtml(p.name)}</div><div class="meta">${p.finished ? (p.rankTitle || '上がり') : `残り${p.handCount}枚`}${p.connected === false ? ' / 切断' : ''}</div>`;
    opp.appendChild(div);
  });

  // 場札
  const fc = el('fieldCards');
  fc.innerHTML = '';
  if (!state.field) {
    fc.innerHTML = '<span class="empty-note">場は空です。好きな役を出せます。</span>';
  } else {
    state.field.cards.forEach((c) => fc.appendChild(cardEl(c, { selectable: false })));
  }

  renderPendingBanner(state);

  // 自分の手札
  const handWrap = el('myHand');
  handWrap.innerHTML = '';
  const interactive = canInteractWithHand(state);
  sortHand(state.myHand).forEach((card) => {
    const selected = selectedCardIds.has(card.id);
    handWrap.appendChild(
      cardEl(card, {
        selectable: interactive,
        selected,
        onClick: () => {
          if (selected) selectedCardIds.delete(card.id);
          else selectedCardIds.add(card.id);
          renderGame(lastState);
        },
      })
    );
  });

  const normalTurnActive = myTurn;
  el('playBtn').classList.toggle('hidden', !normalTurnActive);
  el('passBtn').classList.toggle('hidden', !normalTurnActive || !state.field);

  // ログ
  const logList = el('logList');
  logList.innerHTML = '';
  state.log.slice().reverse().forEach((line) => {
    const div = document.createElement('div');
    div.textContent = line;
    logList.appendChild(div);
  });
}

function canInteractWithHand(state) {
  if (state.pending && state.pending.isMe) return true;
  if (state.pendingExchanges && state.pendingExchanges.some((pe) => pe.isMe)) return true;
  if (state.turnPlayerId === myId && !state.pending && (!state.pendingExchanges || state.pendingExchanges.length === 0)) return true;
  return false;
}

function renderPendingBanner(state) {
  const banner = el('pendingBanner');
  banner.innerHTML = '';
  selectedGiveTarget = selectedGiveTarget || null;

  let content = null;

  if (state.pending) {
    if (state.pending.isMe) {
      if (state.pending.kind === 'give') {
        const others = state.players.filter((p) => p.id !== myId && !p.finished);
        content = document.createElement('div');
        content.innerHTML = `<strong>7渡し:</strong> 誰に何枚渡すか選んでください(${state.pending.count}枚)`;
        const targetWrap = document.createElement('div');
        targetWrap.className = 'target-list';
        others.forEach((p) => {
          const btn = document.createElement('button');
          btn.className = 'target' + (selectedGiveTarget === p.id ? ' secondary' : '');
          btn.textContent = (selectedGiveTarget === p.id ? '✓ ' : '') + p.name;
          btn.addEventListener('click', () => {
            selectedGiveTarget = p.id;
            renderGame(lastState);
          });
          targetWrap.appendChild(btn);
        });
        content.appendChild(targetWrap);

        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = `選んだ${selectedCardIds.size}枚を渡す`;
        confirmBtn.style.marginTop = '10px';
        confirmBtn.disabled = !selectedGiveTarget || selectedCardIds.size !== state.pending.count;
        confirmBtn.addEventListener('click', () => {
          socket.emit('giveCards', { targetPlayerId: selectedGiveTarget, cardIds: Array.from(selectedCardIds) });
          selectedCardIds.clear();
          selectedGiveTarget = null;
        });
        content.appendChild(confirmBtn);
      } else if (state.pending.kind === 'discard') {
        content = document.createElement('div');
        content.innerHTML = `<strong>10捨て:</strong> 捨てるカードを${state.pending.count}枚選んでください`;
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = `選んだ${selectedCardIds.size}枚を捨てる`;
        confirmBtn.style.marginTop = '10px';
        confirmBtn.disabled = selectedCardIds.size !== state.pending.count;
        confirmBtn.addEventListener('click', () => {
          socket.emit('discardCards', { cardIds: Array.from(selectedCardIds) });
          selectedCardIds.clear();
        });
        content.appendChild(confirmBtn);
      }
    } else {
      content = document.createElement('div');
      const label = state.pending.kind === 'give' ? '7渡し' : '10捨て';
      content.textContent = `${state.pending.playerName} さんの${label}の選択を待っています…`;
    }
  } else if (state.pendingExchanges && state.pendingExchanges.length > 0) {
    const mine = state.pendingExchanges.find((pe) => pe.isMe);
    if (mine) {
      content = document.createElement('div');
      content.innerHTML = `<strong>カード交換(${mine.tierLabel}):</strong> ${mine.toPlayerName} さんに返すカードを${mine.count}枚選んでください`;
      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = `選んだ${selectedCardIds.size}枚を返す`;
      confirmBtn.style.marginTop = '10px';
      confirmBtn.disabled = selectedCardIds.size !== mine.count;
      confirmBtn.addEventListener('click', () => {
        socket.emit('exchangeReturn', { cardIds: Array.from(selectedCardIds) });
        selectedCardIds.clear();
      });
      content.appendChild(confirmBtn);
    } else {
      const waitingNames = state.pendingExchanges.map((pe) => pe.playerName).join(' / ');
      content = document.createElement('div');
      content.textContent = `カード交換待ち(${waitingNames})…`;
    }
  }

  if (content) {
    banner.appendChild(content);
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
