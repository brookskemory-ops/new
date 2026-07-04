/* The Dealer Below — pixel sprite data + renderer
   Sprites are 16x16 character maps rendered to <canvas> at chunky scale. */

const PAL = {
  k: '#241f33', K: '#3a3153',           // cloak dark / light
  e: '#ffd27f',                          // glowing eyes / lantern light
  l: '#ff9a3c', h: '#8a7a5c',            // lantern flame / handle
  b: '#e8e0c9', d: '#6b6357',            // bone / bone shadow
  r: '#d04a3a',                          // red glow
  g: '#7a9450', G: '#55703a',            // rot green / dark
  w: '#9fb8c8', W: '#6f8a9c',            // wisp / wisp shadow
  p: '#9b6dff',                          // curse purple
  v: '#4a3a66', V: '#6d5a94',            // robe / trim
  a: '#5a6672', A: '#8494a4',            // armor / highlight
  c: '#f2ead8', x: '#7a3b8f',            // card face / card back
  s: '#3c3547',                          // stone
};

const SPRITES = {
  hero: [
    '................',
    '......kkkk......',
    '.....kkkkkk.....',
    '....kkkkkkkk....',
    '....kke..ekk....',
    '....kkkkkkkk....',
    '.....kkkkkk.....',
    '....kkkkkkkk....',
    '...kkKKKKKKkk...',
    '...kKKKKKKKKk...',
    '...kKKKKKKKKkh..',
    '...kKKKKKKKKkl..',
    '....kKKKKKKk.e..',
    '....kKKKKKKk....',
    '....kk....kk....',
    '...kkk....kkk...',
  ],
  boneling: [
    '................',
    '.....bbbbbb.....',
    '....bbbbbbbb....',
    '....brrbbrrb....',
    '....bbbbbbbb....',
    '.....bddddb.....',
    '......bbbb......',
    '....bbbbbbbb....',
    '...b.bbddbb.b...',
    '...b.bbbbbb.b...',
    '...b..bbbb..b...',
    '......bddb......',
    '.....bb..bb.....',
    '.....b....b.....',
    '....bb....bb....',
    '................',
  ],
  rothound: [
    '................',
    '................',
    '..........ggg...',
    '.........grrgg..',
    '....gggggggggg..',
    '...gggggggggGg..',
    '..gGgggggggg....',
    '..g.gggggggg....',
    '..g.ggG..gGg....',
    '....gg....gg....',
    '....g......g....',
    '...gg.....gg....',
    '...g.......g....',
    '..gg......gg....',
    '................',
    '................',
  ],
  gravewisp: [
    '................',
    '.....wwwww......',
    '....wwwwwww.....',
    '...wwwwwwwww....',
    '...wpwwwwwpw....',
    '...wwwwwwwww....',
    '...wwwWWWwww....',
    '....wwwwwww.....',
    '....wwwwww......',
    '...wwwwwww......',
    '....wwWwww......',
    '...ww.www.......',
    '....w..ww.......',
    '.......w........',
    '................',
    '................',
  ],
  cultist: [
    '................',
    '......vvvv......',
    '.....vvvvvv.....',
    '.....ve..ev.....',
    '.....vvvvvv.....',
    '....vvvvvvvv....',
    '...vvvVVVVvvv...',
    '...vvVvvvvVvv...',
    '..vvvVvvvvVvvv..',
    '..v.vVvvvvVv.v..',
    '..v.vVvvvvVv.v..',
    '....vVvvvvVv....',
    '....vvvvvvvv....',
    '...vvvvvvvvvv...',
    '...vvvvvvvvvv...',
    '................',
  ],
  deckwarden: [
    '................',
    '....aaaaaaaa....',
    '...aaaaaaaaaa...',
    '...aarrrrrraa...',
    '...aaaaaaaaaa...',
    '..aaAAAAAAAAaa..',
    '..aaAaaaaaaAaa..',
    '.aaaAaaaaaaAaaa.',
    '.a.aAaaaaaaAa.a.',
    '.a.aAAAAAAAAa.a.',
    '.a..aaaaaaaa..a.',
    '....aaaaaaaa....',
    '....aaa..aaa....',
    '....aaa..aaa....',
    '...aaaa..aaaa...',
    '................',
  ],
  dealershand: [
    '....xxxxxx......',
    '....xccccx......',
    '....xcpccx......',
    '....xccpcx......',
    '....xccccx......',
    '....xxxxxx......',
    '................',
    '..b..b..b..b....',
    '..bb.bb.bb.bb...',
    '..bbbbbbbbbbb...',
    '.bbbbbbbbbbbb...',
    '.bbbbbbbbbbbbb..',
    '..bbbbbbbbbbb...',
    '...bbbbbbbbb....',
    '....bbbbbbb.....',
    '.....bbbbb......',
  ],
  dealercard: [
    '................',
    '...xxxxxxxxxx...',
    '...xxxxxxxxxx...',
    '...xxpxxxxpxx...',
    '...xxxppppxxx...',
    '...xxpxxxxpxx...',
    '...xxxxxxxxxx...',
    '...xxpxxxxpxx...',
    '...xxxppppxxx...',
    '...xxpxxxxpxx...',
    '...xxxxxxxxxx...',
    '...xxxxxxxxxx...',
    '................',
    '................',
    '................',
    '................',
  ],
};

function drawSprite(name, scale = 6) {
  const map = SPRITES[name];
  const canvas = document.createElement('canvas');
  const h = map.length, w = map[0].length;
  canvas.width = w * scale;
  canvas.height = h * scale;
  canvas.className = 'sprite';
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = map[y][x];
      if (ch === '.' || !PAL[ch]) continue;
      ctx.fillStyle = PAL[ch];
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas;
}
