const game = require('../game');
const cards = require('../cards');

// 基本ロジックのテスト(サーバー起動なしでgame.js単体を検証)
const room = game.makeRoom('TEST');
['p1','p2','p3','p4'].forEach((id,i)=>game.addPlayer(room, id, `Player${i+1}`));
game.startGame(room);
console.log('deck count:', room.deckCount, 'hand sizes:', room.players.map(p=>p.hand.length));

// 山札合計枚数確認
const total = room.players.reduce((s,p)=>s+p.hand.length,0);
console.log('total cards dealt:', total, 'expected', 54*room.deckCount);

// combo detection test
const c1 = {id:'x1', suit:'S', rank:'7'};
const c2 = {id:'x2', suit:'H', rank:'7'};
const combo = cards.detectCombo([c1,c2], room.rules);
console.log('pair combo:', combo && combo.type, combo && combo.size);

const seqCards = [
  {id:'s1', suit:'S', rank:'3'},
  {id:'s2', suit:'S', rank:'4'},
  {id:'s3', suit:'S', rank:'5'},
];
const seqCombo = cards.detectCombo(seqCards, {sequence:true});
console.log('sequence combo:', seqCombo && seqCombo.type, seqCombo && seqCombo.size);

// canBeat test
const fieldCombo = cards.detectCombo([{id:'f1', suit:'H', rank:'5'}], {});
const strongerCombo = cards.detectCombo([{id:'f2', suit:'H', rank:'8'}], {});
console.log('canBeat normal (8 beats 5):', cards.canBeat(strongerCombo, fieldCombo, false));
console.log('canBeat reversed (8 beats 5 under revolution, should be false):', cards.canBeat(strongerCombo, fieldCombo, true));

// full play simulation: force known hands to test 7-give / 8-cut / 10-discard / jack-back
room.players[0].hand = [
  {id:'a1', suit:'S', rank:'7'},
  {id:'a2', suit:'H', rank:'7'},
  {id:'a3', suit:'D', rank:'3'},
];
room.players[1].hand = [{id:'b1', suit:'C', rank:'8'}];
room.players[2].hand = [{id:'c1', suit:'D', rank:'9'}];
room.players[3].hand = [{id:'d1', suit:'H', rank:'9'}];
room.turnIndex = 0;
room.field = null;

let res = game.play(room, 'p1', ['a1','a2']); // pair of 7s -> triggers give (2 cards)
console.log('play pair of 7s result:', res, 'pending:', room.pending);

res = game.giveCards(room, 'p1', 'p2', ['a3']);
console.log('giveCards result (only 1 card, need 1 since hand had 1 left):', res);
console.log('p1 hand after give:', room.players[0].hand.map(c=>c.id));
console.log('p2 hand after receive:', room.players[1].hand.map(c=>c.id));
console.log('turnIndex now:', room.turnIndex);


console.log('--- 8-cut test (fresh field) ---');
room.field = null;
room.turnIndex = 1; // p2's turn, field empty
res = game.play(room, 'p2', ['b1']); // 8 single, field empty -> anything OK, then 8-cut clears & p2 goes again
console.log('play 8 result:', res, 'field:', room.field, 'turnIndex(should stay 1):', room.turnIndex);

console.log('--- jack-back test ---');
room.field = null;
room.players[2].hand.push({id:'jk1', suit:'S', rank:'J'});
room.turnIndex = 2;
res = game.play(room, 'p3', ['jk1']);
console.log('play J result:', res, 'elevenBackActive(should be true):', room.elevenBackActive);

console.log('--- round end test (small room) ---');
const room2 = game.makeRoom('T2');
['x1','x2'].forEach((id,i)=>game.addPlayer(room2, id, `P${i+1}`));
game.startGame(room2);
// force tiny hands to finish quickly
room2.players[0].hand = [{id:'z1', suit:'S', rank:'3'}];
room2.players[1].hand = [{id:'z2', suit:'H', rank:'4'}, {id:'z3', suit:'H', rank:'5'}];
room2.turnIndex = 0;
room2.field = null;
let r2 = game.play(room2, 'x1', ['z1']);
console.log('p1 plays last card:', r2, 'started:', room2.started, 'lastRoundResult:', room2.lastRoundResult);

console.log('--- joker behavior test ---');
const jokerCombo = cards.detectCombo([{id:'jk', joker:true}], {});
const kingCombo = cards.detectCombo([{id:'kg', suit:'S', rank:'K'}], {});
console.log('king cannot beat joker on field:', cards.canBeat(kingCombo, jokerCombo, false, {spade3Return:true}));
console.log('king cannot beat joker even reversed:', cards.canBeat(kingCombo, jokerCombo, true, {spade3Return:true}));
const spade3Combo = cards.detectCombo([{id:'s3', suit:'S', rank:'3'}], {});
console.log('spade3 CAN beat joker when rule ON:', cards.canBeat(spade3Combo, jokerCombo, false, {spade3Return:true}));
console.log('spade3 CANNOT beat joker when rule OFF:', cards.canBeat(spade3Combo, jokerCombo, false, {spade3Return:false}));
console.log('joker CAN beat a king:', cards.canBeat(jokerCombo, kingCombo, false, {}));
console.log('joker CAN beat a king even reversed(joker immune):', cards.canBeat(jokerCombo, kingCombo, true, {}));

console.log('--- suit lock (縛り) test ---');
const room3 = game.makeRoom('T3');
['a','b'].forEach((id,i)=>game.addPlayer(room3, id, `Pl${i+1}`));
game.startGame(room3);
room3.players[0].hand = [
  {id:'h3', suit:'H', rank:'3'},
  {id:'h5', suit:'H', rank:'5'},
  {id:'h7', suit:'H', rank:'7'},
  {id:'h9', suit:'H', rank:'9'},
];
room3.players[1].hand = [
  {id:'s4', suit:'S', rank:'4'},
  {id:'s6', suit:'S', rank:'6'},
  {id:'s8', suit:'S', rank:'8'},
  {id:'sK', suit:'S', rank:'K'},
];
room3.turnIndex = 0;
room3.field = null;
let r;
r = game.play(room3, 'a', ['h3']); console.log('p1 H3:', r.ok, 'suitStreak', room3.suitStreakCount, room3.suitLockActive);
r = game.play(room3, 'b', ['s4']); console.log('p2 S4 (breaks streak, different suit):', r.ok, 'suitStreak', room3.suitStreakCount, room3.suitLockActive);
r = game.play(room3, 'a', ['h5']); console.log('p1 H5:', r.ok, 'suitStreak', room3.suitStreakCount, room3.suitLockActive);
r = game.play(room3, 'b', ['s6']); console.log('p2 S6 breaks again(diff suit):', r.ok, 'suitStreak', room3.suitStreakCount, room3.suitLockActive);
r = game.play(room3, 'a', ['h7']); console.log('p1 H7 start H streak(1):', room3.suitStreakCount, room3.suitLockActive);
r = game.play(room3, 'a', ['h7']); // invalid: not their turn actually turn moved to b after a's play; let's just check via manual forced sequence instead

console.log('--- suit lock threshold test (same suit 3 in a row) ---');
const room4 = game.makeRoom('T4');
['a','b'].forEach((id,i)=>game.addPlayer(room4, id, `Q${i+1}`));
game.startGame(room4);
room4.players[0].hand = [{id:'x3', suit:'H', rank:'3'},{id:'x7', suit:'H', rank:'7'},{id:'xQ', suit:'H', rank:'Q'}];
room4.players[1].hand = [{id:'y5', suit:'H', rank:'5'},{id:'y9', suit:'H', rank:'9'}];
room4.turnIndex = 0;
room4.field = null;
let rr;
rr = game.play(room4, 'a', ['x3']); console.log('1 H3 ->', room4.suitStreakCount, room4.suitLockActive);
rr = game.play(room4, 'b', ['y5']); console.log('2 H5 ->', room4.suitStreakCount, room4.suitLockActive);
rr = game.play(room4, 'a', ['x7']); console.log('3 H7 -> should lock now:', room4.suitStreakCount, room4.suitLockActive, room4.suitLockSuit);
// now p2 tries to play a non-heart -> should be rejected due to suit lock
room4.players[1].hand.push({id:'zK', suit:'S', rank:'K'});
rr = game.play(room4, 'b', ['zK']); console.log('non-heart while locked (should fail):', rr);
rr = game.play(room4, 'b', ['y9']); console.log('heart while locked (should succeed):', rr.ok);

console.log('--- number lock threshold test ---');
const room5 = game.makeRoom('T5');
['a','b'].forEach((id,i)=>game.addPlayer(room5, id, `N${i+1}`));
game.startGame(room5);
room5.rules.numberLock = true;
room5.players[0].hand = [{id:'n3', suit:'H', rank:'3'},{id:'n5', suit:'D', rank:'5'},{id:'n7', suit:'C', rank:'7'}];
room5.players[1].hand = [{id:'n4', suit:'S', rank:'4'},{id:'n6', suit:'H', rank:'6'}];
room5.turnIndex = 0;
room5.field = null;
rr = game.play(room5, 'a', ['n3']); console.log('play 3 ->', room5.numberStreakCount, room5.numberLockActive);
rr = game.play(room5, 'b', ['n4']); console.log('play 4(+1) ->', room5.numberStreakCount, room5.numberLockActive);
rr = game.play(room5, 'a', ['n5']); console.log('play 5(+1) -> should lock:', room5.numberStreakCount, room5.numberLockActive);
rr = game.play(room5, 'b', ['n6']); console.log('play 6 while number-locked and is +1 (should succeed):', rr.ok);
room5.players[0].hand.push({id:'n9', suit:'H', rank:'9'});
rr = game.play(room5, 'a', ['n9']); console.log('play 9 while number-locked, not +1 (should fail):', rr);
