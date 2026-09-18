// カード表現・役判定・強さ比較のロジック
// カード: 通常札 { id, suit: 'S'|'H'|'D'|'C', rank: '3'..'2' }
//        ジョーカー { id, joker: true }

const RANK_ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const SUITS = ['S', 'H', 'D', 'C'];
const JOKER_STRENGTH = 13; // RANK_ORDER の長さと同じ = 最強

function rankStrength(rank) {
  return RANK_ORDER.indexOf(rank);
}

function cardStrength(card) {
  if (card.joker) return JOKER_STRENGTH;
  return rankStrength(card.rank);
}

// 山札生成。deckCount 個の52枚 + 2枚ジョーカー を束ねる
function buildDeck(deckCount) {
  const cards = [];
  let idCounter = 0;
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANK_ORDER) {
        cards.push({ id: `c${idCounter++}`, suit, rank });
      }
    }
    cards.push({ id: `c${idCounter++}`, joker: true });
    cards.push({ id: `c${idCounter++}`, joker: true });
  }
  return cards;
}

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// プレイ人数に応じて使用デッキ数を決定
function decideDeckCount(playerCount) {
  if (playerCount <= 5) return 1;
  if (playerCount <= 8) return 2;
  return 3;
}

// 手札を配る。余りは前方の席から1枚ずつ追加
function dealHands(playerCount) {
  const deckCount = decideDeckCount(playerCount);
  const deck = shuffle(buildDeck(deckCount));
  const hands = Array.from({ length: playerCount }, () => []);
  let idx = 0;
  const per = Math.floor(deck.length / playerCount);
  const remainder = deck.length % playerCount;
  for (let p = 0; p < playerCount; p++) {
    const count = per + (p < remainder ? 1 : 0);
    for (let i = 0; i < count; i++) {
      hands[p].push(deck[idx++]);
    }
  }
  return { hands, deckCount, totalCards: deck.length };
}

// 選択されたカード群から役の種類を判定する
// rules.sequence が true なら階段を許可
// 戻り値: null(不正) | { type: 'single'|'group'|'sequence', size, cards, topStrength, includesRank(rank) }
function detectCombo(cards, rules) {
  if (!cards || cards.length === 0) return null;

  if (cards.length === 1) {
    return finalizeCombo('single', 1, cards, cards);
  }

  const jokers = cards.filter((c) => c.joker);
  const normals = cards.filter((c) => !c.joker);

  // 同ランクの組(ペア/スリーカード/フォーカード...) ジョーカーは今回組み込み非対応
  if (jokers.length === 0) {
    const ranks = new Set(normals.map((c) => c.rank));
    if (ranks.size === 1) {
      return finalizeCombo('group', cards.length, cards, normals);
    }

    // 階段(同スート連続ランク)
    if (rules.sequence && cards.length >= 3) {
      const suits = new Set(normals.map((c) => c.suit));
      if (suits.size === 1) {
        const sorted = normals.slice().sort((a, b) => rankStrength(a.rank) - rankStrength(b.rank));
        let isSeq = true;
        for (let i = 1; i < sorted.length; i++) {
          if (rankStrength(sorted[i].rank) !== rankStrength(sorted[i - 1].rank) + 1) {
            isSeq = false;
            break;
          }
        }
        if (isSeq) {
          return finalizeCombo('sequence', cards.length, cards, sorted);
        }
      }
    }
  }

  return null; // 不正な組み合わせ(ジョーカー混在の組・階段は今回非対応)
}

function finalizeCombo(type, size, allCards, refCardsForStrength) {
  const topStrength = Math.max(...refCardsForStrength.map((c) => cardStrength(c)));
  const ranksIncluded = new Set(allCards.filter((c) => !c.joker).map((c) => c.rank));
  return {
    type,
    size,
    cards: allCards,
    topStrength,
    includesRank: (r) => ranksIncluded.has(r),
    rankCount: (r) => allCards.filter((c) => !c.joker && c.rank === r).length,
  };
}

// combo が場の cardsOnField(直前の役)に勝てるか判定
// reversed = true なら弱い方が勝ち(革命 / 11バックの実効反転)
// ジョーカー単体は革命・11バックの影響を受けず常に「最強の一枚」として扱う
// (スペード3返しルールが有効な場合のみ、スペード3単体で例外的に返せる)
function canBeat(combo, fieldCombo, reversed, rules = {}) {
  if (!fieldCombo) return true; // 場が空なら何でも出せる

  const fieldIsJokerSingle = fieldCombo.type === 'single' && fieldCombo.cards[0].joker;
  const comboIsJokerSingle = combo.type === 'single' && combo.cards[0].joker;

  if (fieldIsJokerSingle) {
    if (
      rules.spade3Return &&
      combo.type === 'single' &&
      !combo.cards[0].joker &&
      combo.cards[0].suit === 'S' &&
      combo.cards[0].rank === '3'
    ) {
      return true; // スペード3返し
    }
    return false; // ジョーカーは(スペード3返し以外では)誰にも負けない
  }

  if (combo.type !== fieldCombo.type) return false;
  if (combo.size !== fieldCombo.size) return false;

  if (comboIsJokerSingle) return true; // ジョーカーは常に最強の一枚として勝てる

  if (!reversed) {
    return combo.topStrength > fieldCombo.topStrength;
  }
  return combo.topStrength < fieldCombo.topStrength;
}

module.exports = {
  RANK_ORDER,
  SUITS,
  JOKER_STRENGTH,
  rankStrength,
  cardStrength,
  buildDeck,
  shuffle,
  decideDeckCount,
  dealHands,
  detectCombo,
  canBeat,
};
