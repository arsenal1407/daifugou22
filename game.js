const { dealHands, detectCombo, checkLegal, computePlayableCardIds, cardStrength } = require('./cards');

const SUIT_LOCK_THRESHOLD = 3;
const NUMBER_LOCK_THRESHOLD = 3;

const DEFAULT_RULES = {
  sevenGive: true, // 7渡し
  eightCut: true, // 8切り
  tenDiscard: true, // 10捨て
  jackBack: true, // 11バック
  sequence: true, // 階段
  sequenceRevolution: true, // 階段革命(階段が有効な場合のみ意味を持つ)
  quadRevolution: true, // 通常革命(同ランク4枚以上)
  classSystem: true, // 階級制(カード交換あり)
  spade3Return: true, // スペード3返し
  suitLock: true, // 縛り(マーク)
  numberLock: false, // 縛り(数字)
};

function makeRoom(code) {
  return {
    code,
    hostId: null,
    players: [], // { id, name, hand, connected, finished, finishOrder, rankTitle }
    rules: { ...DEFAULT_RULES },
    started: false,
    round: 0,
    turnIndex: 0,
    fieldOwnerIndex: null,
    field: null, // { combo, cards }
    passCount: 0,
    revolutionActive: false,
    elevenBackActive: false,
    suitLockActive: false,
    suitLockSuit: null,
    suitStreakSuit: null,
    suitStreakCount: 0,
    numberLockActive: false,
    numberStreakCount: 0,
    finishOrder: [],
    lastFinishOrder: null,
    pending: null, // { kind: 'give'|'discard', playerIndex, count }
    pendingSteps: [],
    pendingEightCut: false,
    pendingPlayerIndex: null,
    pendingExchanges: [], // { playerIndex, count, toIndex, tierLabel }
    log: [],
    lastRoundResult: null,
  };
}

function addPlayer(room, id, name) {
  if (room.players.find((p) => p.id === id)) return;
  room.players.push({
    id,
    name,
    hand: [],
    connected: true,
    finished: false,
    finishOrder: null,
    rankTitle: null,
  });
  if (!room.hostId) room.hostId = id;
}

function removePlayer(room, id) {
  const idx = room.players.findIndex((p) => p.id === id);
  if (idx === -1) return;
  if (!room.started) {
    room.players.splice(idx, 1);
    if (room.hostId === id) {
      room.hostId = room.players.length > 0 ? room.players[0].id : null;
    }
  } else {
    room.players[idx].connected = false;
  }
}

function activeIndices(room) {
  const res = [];
  room.players.forEach((p, i) => {
    if (!p.finished) res.push(i);
  });
  return res;
}

function nextActiveIndex(room, fromIndex) {
  const n = room.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIndex + step) % n;
    if (!room.players[idx].finished) return idx;
  }
  return fromIndex;
}

function log(room, msg) {
  room.log.push(msg);
  if (room.log.length > 100) room.log.shift();
}

// 場が流れる(リセットされる)ときに戻す一時的な状態(11バック・縛り)
function resetFlowState(room) {
  room.elevenBackActive = false;
  room.suitLockActive = false;
  room.suitLockSuit = null;
  room.suitStreakSuit = null;
  room.suitStreakCount = 0;
  room.numberLockActive = false;
  room.numberStreakCount = 0;
}

function buildCtx(room) {
  return {
    rules: room.rules,
    reversed: room.revolutionActive !== room.elevenBackActive,
    suitLockActive: room.suitLockActive,
    suitLockSuit: room.suitLockSuit,
    numberLockActive: room.numberLockActive,
  };
}

function startGame(room) {
  const n = room.players.length;
  const { hands, deckCount } = dealHands(n);
  room.players.forEach((p, i) => {
    p.hand = hands[i];
    p.finished = false;
    p.finishOrder = null;
    p.rankTitle = null;
  });
  room.deckCount = deckCount;
  room.started = true;
  room.round = 1;
  room.field = null;
  room.fieldOwnerIndex = null;
  room.passCount = 0;
  room.revolutionActive = false;
  resetFlowState(room);
  room.finishOrder = [];
  room.pending = null;
  room.pendingSteps = [];
  room.pendingEightCut = false;
  room.pendingExchanges = [];
  room.turnIndex = Math.floor(Math.random() * n);
  log(room, `ゲーム開始(${n}人 / ${deckCount}デッキ)`);
}

function tierLabelsFor(n) {
  // n人時のランク名一覧(良い順)
  if (n <= 2) return ['大富豪', '大貧民'];
  if (n <= 4) return ['大富豪', ...Array(n - 2).fill('平民'), '大貧民'];
  return ['大富豪', '富豪', ...Array(n - 4).fill('平民'), '貧民', '大貧民'];
}

function assignRankTitles(room) {
  const n = room.players.length;
  const labels = tierLabelsFor(n);
  room.finishOrder.forEach((playerIdx, order) => {
    room.players[playerIdx].rankTitle = labels[order] || '平民';
    room.players[playerIdx].finishOrder = order + 1;
  });
}

function checkRoundEnd(room) {
  const remaining = activeIndices(room);
  if (remaining.length <= 1) {
    if (remaining.length === 1) {
      room.finishOrder.push(remaining[0]);
      room.players[remaining[0]].finished = true;
    }
    assignRankTitles(room);
    room.lastFinishOrder = room.finishOrder.slice();
    room.lastRoundResult = room.players.map((p) => ({ name: p.name, rankTitle: p.rankTitle }));
    room.started = false; // 次ラウンド開始待ち(ロビー的状態)
    room.field = null;
    room.pending = null;
    room.pendingSteps = [];
    room.pendingExchanges = [];
    log(room, `ラウンド${room.round}終了。結果: ${room.lastRoundResult.map((r) => `${r.name}(${r.rankTitle})`).join(' / ')}`);
    return true;
  }
  return false;
}

function findPlayer(room, id) {
  return room.players.find((p) => p.id === id);
}

function playerIndexById(room, id) {
  return room.players.findIndex((p) => p.id === id);
}

function play(room, playerId, cardIds) {
  const idx = playerIndexById(room, playerId);
  if (idx === -1) return { error: 'プレイヤーが見つかりません' };
  if (!room.started) return { error: 'ゲームが開始されていません' };
  if (room.pending) return { error: '他のプレイヤーの処理待ちです' };
  if (room.pendingExchanges.length > 0) return { error: 'カード交換待ちです' };
  if (room.turnIndex !== idx) return { error: 'あなたの番ではありません' };

  const player = room.players[idx];
  const cards = cardIds.map((cid) => player.hand.find((c) => c.id === cid)).filter(Boolean);
  if (cards.length !== cardIds.length) return { error: '手札にないカードが含まれています' };

  const combo = detectCombo(cards, room.rules);
  if (!combo) return { error: '出せない組み合わせです' };

  const fieldCombo = room.field ? room.field.combo : null;
  const ctx = buildCtx(room);
  if (!checkLegal(combo, fieldCombo, ctx)) {
    return { error: 'その役では場の札に勝てません(縛りを含む)' };
  }

  const events = [];
  const isJokerSingle = combo.type === 'single' && combo.cards[0].joker;

  // 縛り(マーク)の更新
  if (room.rules.suitLock && !isJokerSingle) {
    if (combo.uniformSuit && combo.uniformSuit === room.suitStreakSuit) {
      room.suitStreakCount += 1;
    } else if (combo.uniformSuit) {
      room.suitStreakSuit = combo.uniformSuit;
      room.suitStreakCount = 1;
    } else {
      room.suitStreakSuit = null;
      room.suitStreakCount = 0;
    }
    if (room.suitStreakCount >= SUIT_LOCK_THRESHOLD && !room.suitLockActive) {
      room.suitLockActive = true;
      room.suitLockSuit = room.suitStreakSuit;
      log(room, `${suitName(room.suitLockSuit)}縛り発動!`);
      events.push({ type: 'suitLock', suit: room.suitLockSuit });
    }
  }

  // 縛り(数字)の更新: 直前の役からちょうど+1のランクが連続しているかを見る
  if (room.rules.numberLock && !isJokerSingle) {
    if (fieldCombo && combo.topStrength === fieldCombo.topStrength + 1) {
      room.numberStreakCount += 1;
    } else {
      room.numberStreakCount = 1;
    }
    if (room.numberStreakCount >= NUMBER_LOCK_THRESHOLD && !room.numberLockActive) {
      room.numberLockActive = true;
      log(room, `数字縛り発動!`);
      events.push({ type: 'numberLock' });
    }
  }

  // 手札から除去
  const idSet = new Set(cardIds);
  player.hand = player.hand.filter((c) => !idSet.has(c.id));

  room.field = { combo };
  log(room, `${player.name} が ${describeCombo(combo)} を出しました`);

  // 革命判定
  if (room.rules.quadRevolution && combo.type === 'group' && combo.size >= 4) {
    room.revolutionActive = !room.revolutionActive;
    log(room, `革命発生!(通常革命)`);
    events.push({ type: 'revolution', active: room.revolutionActive });
  }
  if (room.rules.sequence && room.rules.sequenceRevolution && combo.type === 'sequence' && combo.size >= 4) {
    room.revolutionActive = !room.revolutionActive;
    log(room, `革命発生!(階段革命)`);
    events.push({ type: 'revolution', active: room.revolutionActive });
  }

  // 11バック判定
  if (room.rules.jackBack && combo.includesRank('J')) {
    room.elevenBackActive = !room.elevenBackActive;
    log(room, `11バック${room.elevenBackActive ? '発動' : '解除'}!`);
    events.push({ type: 'elevenBack', active: room.elevenBackActive });
  }

  const wentOut = player.hand.length === 0;
  if (wentOut) {
    player.finished = true;
    room.finishOrder.push(idx);
    log(room, `${player.name} が上がりました!`);
  }

  // 8切り・7渡し・10捨てのイベント表示(実際の処理は下のステップ/finalizeで行う)
  if (room.rules.eightCut && combo.includesRank('8')) {
    events.push({ type: 'eightCut' });
  }
  if (!wentOut && room.rules.sevenGive && combo.includesRank('7')) {
    events.push({ type: 'sevenGive' });
  }
  if (!wentOut && room.rules.tenDiscard && combo.includesRank('10')) {
    events.push({ type: 'tenDiscard' });
  }

  // 7渡し・10捨てのペンディング積み上げ(上がった場合はスキップ = 渡す/捨てる札がないため)
  const steps = [];
  if (!wentOut) {
    if (room.rules.sevenGive && combo.includesRank('7')) {
      steps.push({ kind: 'give', count: combo.rankCount('7') });
    }
    if (room.rules.tenDiscard && combo.includesRank('10')) {
      steps.push({ kind: 'discard', count: combo.rankCount('10') });
    }
  }
  room.pendingSteps = steps;
  room.pendingEightCut = room.rules.eightCut && combo.includesRank('8');
  room.pendingPlayerIndex = idx;

  processNextPendingStep(room);
  return { ok: true, events };
}

function describeCombo(combo) {
  const names = combo.cards.map((c) => (c.joker ? 'JOKER' : `${suitName(c.suit)}${c.rank}`));
  return names.join(' ');
}

function suitName(s) {
  return { S: '♠', H: '♥', D: '♦', C: '♣' }[s] || s;
}

function processNextPendingStep(room) {
  if (room.pendingSteps && room.pendingSteps.length > 0) {
    const step = room.pendingSteps[0];
    room.pending = { kind: step.kind, playerIndex: room.pendingPlayerIndex, count: step.count };
    return;
  }
  room.pending = null;
  finalizeAfterPlay(room);
}

function finalizeAfterPlay(room) {
  const playerIndex = room.pendingPlayerIndex;
  const player = room.players[playerIndex];

  if (checkRoundEnd(room)) {
    room.pendingEightCut = false;
    room.pendingPlayerIndex = null;
    return;
  }

  if (room.pendingEightCut) {
    room.field = null;
    resetFlowState(room);
    room.passCount = 0;
    room.fieldOwnerIndex = null;
    room.turnIndex = player.finished ? nextActiveIndex(room, playerIndex) : playerIndex;
    log(room, `8切りで場が流れました`);
  } else {
    room.passCount = 0;
    room.fieldOwnerIndex = playerIndex;
    room.turnIndex = nextActiveIndex(room, playerIndex);
  }
  room.pendingEightCut = false;
  room.pendingPlayerIndex = null;
}

function giveCards(room, playerId, targetPlayerId, cardIds) {
  if (!room.pending || room.pending.kind !== 'give') return { error: '現在は札渡しの状態ではありません' };
  const idx = playerIndexById(room, playerId);
  if (idx !== room.pending.playerIndex) return { error: 'あなたの番ではありません' };
  const targetIdx = playerIndexById(room, targetPlayerId);
  if (targetIdx === -1 || room.players[targetIdx].finished) return { error: '渡す相手が不正です' };
  if (targetIdx === idx) return { error: '自分には渡せません' };

  const player = room.players[idx];
  const need = Math.min(room.pending.count, player.hand.length);
  if (cardIds.length !== need) return { error: `${need}枚選んでください` };
  const idSet = new Set(cardIds);
  const moving = player.hand.filter((c) => idSet.has(c.id));
  if (moving.length !== need) return { error: '手札にないカードが含まれています' };

  player.hand = player.hand.filter((c) => !idSet.has(c.id));
  room.players[targetIdx].hand.push(...moving);
  log(room, `${player.name} が ${room.players[targetIdx].name} にカードを${need}枚渡しました(7渡し)`);

  markFinishedIfEmpty(room, idx);
  room.pendingSteps.shift();
  processNextPendingStep(room);
  return { ok: true };
}

function markFinishedIfEmpty(room, idx) {
  const player = room.players[idx];
  if (!player.finished && player.hand.length === 0) {
    player.finished = true;
    room.finishOrder.push(idx);
    log(room, `${player.name} が上がりました!`);
  }
}

function discardCards(room, playerId, cardIds) {
  if (!room.pending || room.pending.kind !== 'discard') return { error: '現在は捨て札の状態ではありません' };
  const idx = playerIndexById(room, playerId);
  if (idx !== room.pending.playerIndex) return { error: 'あなたの番ではありません' };

  const player = room.players[idx];
  const need = Math.min(room.pending.count, player.hand.length);
  if (cardIds.length !== need) return { error: `${need}枚選んでください` };
  const idSet = new Set(cardIds);
  const removing = player.hand.filter((c) => idSet.has(c.id));
  if (removing.length !== need) return { error: '手札にないカードが含まれています' };

  player.hand = player.hand.filter((c) => !idSet.has(c.id));
  log(room, `${player.name} がカードを${need}枚捨てました(10捨て)`);

  markFinishedIfEmpty(room, idx);
  room.pendingSteps.shift();
  processNextPendingStep(room);
  return { ok: true };
}

function pass(room, playerId) {
  const idx = playerIndexById(room, playerId);
  if (idx === -1) return { error: 'プレイヤーが見つかりません' };
  if (!room.started) return { error: 'ゲームが開始されていません' };
  if (room.pending) return { error: '他のプレイヤーの処理待ちです' };
  if (room.pendingExchanges.length > 0) return { error: 'カード交換待ちです' };
  if (room.turnIndex !== idx) return { error: 'あなたの番ではありません' };
  if (!room.field) return { error: '場が空のときはパスできません' };

  room.passCount += 1;
  log(room, `${room.players[idx].name} がパスしました`);

  const remaining = activeIndices(room).length;
  if (room.passCount >= remaining - 1) {
    // 場を流す
    room.field = null;
    resetFlowState(room);
    room.passCount = 0;
    const ownerIdx = room.fieldOwnerIndex;
    if (ownerIdx === null || room.players[ownerIdx].finished) {
      room.turnIndex = nextActiveIndex(room, idx);
    } else {
      room.turnIndex = ownerIdx;
    }
    room.fieldOwnerIndex = null;
    log(room, `場が流れました`);
  } else {
    room.turnIndex = nextActiveIndex(room, idx);
  }
  return { ok: true };
}

function exchangePlan(room) {
  // 前ラウンドの順位から強制交換の計画を作る
  const n = room.players.length;
  if (n < 2 || !room.lastFinishOrder) return [];
  const labels = tierLabelsFor(n);
  const order = room.lastFinishOrder; // index0 = 大富豪 ...
  const plans = [];
  const daifugoIdx = order[0];
  const daihinminIdx = order[order.length - 1];
  plans.push({ giverIdx: daihinminIdx, receiverIdx: daifugoIdx, count: 2, giverLabel: '大貧民', receiverLabel: '大富豪' });
  if (labels.includes('富豪') && labels.includes('貧民')) {
    const fugohIdx = order[1];
    const hinminIdx = order[order.length - 2];
    plans.push({ giverIdx: hinminIdx, receiverIdx: fugohIdx, count: 1, giverLabel: '貧民', receiverLabel: '富豪' });
  }
  return plans;
}

function startNextRound(room, requesterId) {
  if (room.hostId !== requesterId) return { error: 'ホストのみ操作できます' };
  if (room.started) return { error: '既にラウンド中です' };

  const n = room.players.length;
  const { hands, deckCount } = dealHands(n);
  room.players.forEach((p, i) => {
    p.hand = hands[i];
    p.finished = false;
  });
  room.deckCount = deckCount;
  room.round += 1;
  room.field = null;
  room.fieldOwnerIndex = null;
  room.passCount = 0;
  room.revolutionActive = false;
  resetFlowState(room);
  room.finishOrder = [];
  room.pending = null;
  room.pendingSteps = [];
  room.pendingEightCut = false;
  room.pendingExchanges = [];

  const prevLast = room.lastFinishOrder;
  let starterIdx = Math.floor(Math.random() * n);

  if (room.rules.classSystem && prevLast && prevLast.length === n) {
    const plans = exchangePlan(room);
    plans.forEach((plan) => {
      const giver = room.players[plan.giverIdx];
      const receiver = room.players[plan.receiverIdx];
      const sorted = giver.hand.slice().sort((a, b) => cardStrength(b) - cardStrength(a));
      const count = Math.min(plan.count, sorted.length);
      const taken = sorted.slice(0, count);
      const takenIds = new Set(taken.map((c) => c.id));
      giver.hand = giver.hand.filter((c) => !takenIds.has(c.id));
      receiver.hand.push(...taken);
      log(room, `${giver.name}(${plan.giverLabel}) が ${receiver.name}(${plan.receiverLabel}) に強いカードを${count}枚提出`);
      room.pendingExchanges.push({
        playerIndex: plan.receiverIdx,
        toIndex: plan.giverIdx,
        count,
        tierLabel: plan.receiverLabel,
      });
    });
    starterIdx = prevLast[prevLast.length - 1]; // 前回の大貧民から開始
  }

  room.turnIndex = starterIdx;
  room.started = room.pendingExchanges.length === 0;
  log(room, `ラウンド${room.round}開始`);
  return { ok: true };
}

function exchangeReturn(room, playerId, cardIds) {
  const idx = playerIndexById(room, playerId);
  const planIdx = room.pendingExchanges.findIndex((pe) => pe.playerIndex === idx);
  if (planIdx === -1) return { error: '交換対象ではありません' };
  const plan = room.pendingExchanges[planIdx];
  const player = room.players[idx];
  if (cardIds.length !== plan.count) return { error: `${plan.count}枚選んでください` };
  const idSet = new Set(cardIds);
  const moving = player.hand.filter((c) => idSet.has(c.id));
  if (moving.length !== plan.count) return { error: '手札にないカードが含まれています' };

  player.hand = player.hand.filter((c) => !idSet.has(c.id));
  room.players[plan.toIndex].hand.push(...moving);
  log(room, `${player.name} が ${room.players[plan.toIndex].name} にカードを${plan.count}枚返しました`);

  room.pendingExchanges.splice(planIdx, 1);
  if (room.pendingExchanges.length === 0) {
    room.started = true;
    log(room, `カード交換完了。ラウンド${room.round}スタート!`);
  }
  return { ok: true };
}

function serializeForPlayer(room, playerId) {
  const me = findPlayer(room, playerId);
  const fieldCombo = room.field ? room.field.combo : null;
  const ctx = buildCtx(room);
  const playableSet = me ? computePlayableCardIds(me.hand, fieldCombo, ctx) : null;
  return {
    code: room.code,
    hostId: room.hostId,
    rules: room.rules,
    started: room.started,
    round: room.round,
    deckCount: room.deckCount,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
      finished: p.finished,
      connected: p.connected,
      rankTitle: p.rankTitle,
    })),
    myHand: me ? me.hand : [],
    myId: playerId,
    playableCardIds: playableSet ? Array.from(playableSet) : null,
    turnPlayerId: room.players[room.turnIndex] ? room.players[room.turnIndex].id : null,
    field: room.field
      ? {
          type: room.field.combo.type,
          size: room.field.combo.size,
          cards: room.field.combo.cards,
        }
      : null,
    revolutionActive: room.revolutionActive,
    elevenBackActive: room.elevenBackActive,
    suitLockActive: room.suitLockActive,
    suitLockSuit: room.suitLockSuit,
    numberLockActive: room.numberLockActive,
    pending: room.pending
      ? {
          kind: room.pending.kind,
          count: room.pending.count,
          playerId: room.players[room.pending.playerIndex].id,
          playerName: room.players[room.pending.playerIndex].name,
          isMe: room.pending.playerIndex === playerIndexById(room, playerId),
        }
      : null,
    pendingExchanges: room.pendingExchanges.map((pe) => ({
      playerId: room.players[pe.playerIndex].id,
      playerName: room.players[pe.playerIndex].name,
      toPlayerName: room.players[pe.toIndex].name,
      count: pe.count,
      tierLabel: pe.tierLabel,
      isMe: pe.playerIndex === playerIndexById(room, playerId),
    })),
    lastRoundResult: room.lastRoundResult,
    log: room.log.slice(-40),
  };
}

module.exports = {
  DEFAULT_RULES,
  makeRoom,
  addPlayer,
  removePlayer,
  startGame,
  play,
  pass,
  giveCards,
  discardCards,
  exchangeReturn,
  startNextRound,
  serializeForPlayer,
  playerIndexById,
};
