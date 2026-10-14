// ui/pack.js pure helpers: the /media/… stem index and its mapping (the SW's audio path), the per-URL
// "may the pack serve this" decision, the content-type table, and the cache-key helper.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mediaIndexFromUrls, mediaPackUrl, packUsableFor, packUrlFor, mimeForUrl, absoluteUrl,
} from '../../public/js/ui/pack.js';

test('mediaIndexFromUrls: audio files only, extension order the server would try, deduped per stem', () => {
  const index = mediaIndexFromUrls([
    '/assets/audio/bgm/act1.mp3',
    '/assets/audio/bgm/act1.ogg',           // same stem, mp3 wins by the server's AUDIO_EXTS order
    '/assets/audio/sfx/deploy.wav',
    '/assets/audio/voice/char/a.mp3',
    '/assets/char/avatar/x.png',            // not under /assets/audio/
    '/assets/audio/weird/noext',            // no extension
    '/assets/audio/weird/x.txt',            // not an audio extension
    '/assets/audio/weird/.mp3',             // dotfile-shaped: no stem
  ]);
  assert.deepEqual([...index.keys()].sort(), ['bgm/act1', 'sfx/deploy', 'voice/char/a']);
  assert.equal(index.get('bgm/act1').url, '/assets/audio/bgm/act1.mp3');
  assert.equal(mediaIndexFromUrls(null).size, 0);
  assert.equal(mediaIndexFromUrls(['nope']).size, 0);
});

test('mediaPackUrl: the extension-less route resolves to the pack URL, refusals match the server', () => {
  const index = mediaIndexFromUrls(['/assets/audio/bgm/act1.mp3', '/assets/audio/sfx/x.ogg']);
  assert.equal(mediaPackUrl('/media/bgm/act1', index), '/assets/audio/bgm/act1.mp3');
  assert.equal(mediaPackUrl('/media/sfx/x', index), '/assets/audio/sfx/x.ogg');
  assert.equal(mediaPackUrl('/media/sfx/x.ogg', index), '/assets/audio/sfx/x.ogg', 'explicit extension resolves via the stem');
  assert.equal(mediaPackUrl('/media/', index), null, 'empty rest');
  assert.equal(mediaPackUrl('/media/../secret', index), null, 'traversal');
  assert.equal(mediaPackUrl('/media/bgm/act1/', index), null, 'trailing slash');
  assert.equal(mediaPackUrl('/media/bgm/unknown', index), null, 'stem the pack lacks');
  assert.equal(mediaPackUrl('/assets/audio/bgm/act1.mp3', index), null, 'not a /media/ path');
  assert.equal(mediaPackUrl('/media/bgm/act1', null), null, 'no index');
});

test('packUsableFor: pack hit + size agreement; new URLs and size drift go to the network', () => {
  const packSizes = { '/assets/a.png': 100, '/assets/b.png': 200, '/assets/gone.png': 300 };
  const none = null;
  assert.equal(packUsableFor('/assets/a.png', packSizes, none), true, 'no deployed size table: best effort');
  assert.equal(packUsableFor('/assets/new.png', packSizes, none), false, 'URL the pack lacks → network');
  assert.equal(packUsableFor('/assets/a.png', null, none), false, 'no pack at all');
  assert.equal(packUsableFor('/assets/a.png', packSizes, { '/assets/a.png': 100 }), true, 'size agrees');
  assert.equal(packUsableFor('/assets/a.png', packSizes, { '/assets/a.png': 123 }), false, 'content changed → bypass');
  assert.equal(packUsableFor('/assets/b.png', packSizes, { '/assets/a.png': 100 }), false, 'URL missing from the table');
  assert.equal(packUsableFor('/assets/gone.png', packSizes, { '/assets/gone.png': 300 }), true, 'removed upstream but size agrees');
  assert.equal(packUsableFor(42, packSizes, none), false, 'non-string url');
});

test('packUrlFor: 0.2.6 hashed paths resolve to the pack\'s plain keys; /media/ keeps the stem index', () => {
  const index = mediaIndexFromUrls(['/assets/audio/bgm/act1.mp3']);
  assert.equal(packUrlFor('/assets/char/avatar/x.png', index), '/assets/char/avatar/x.png', 'plain path unchanged');
  assert.equal(packUrlFor('/assets/~0123456789abcdef/char/avatar/x.png', index), '/assets/char/avatar/x.png',
    'hashed → plain: the pack and the size table hold no hashed keys');
  assert.equal(packUrlFor('/fonts/~fedcba9876543210/bender.woff2', index), '/fonts/bender.woff2', 'a fonts hash is dropped too');
  assert.equal(packUrlFor('/media/bgm/act1', index), '/assets/audio/bgm/act1.mp3', 'media via the stem index');
  assert.equal(packUrlFor('/media/~0123456789abcdef/bgm/act1', index), '/assets/audio/bgm/act1.mp3', 'hashed media resolves as well');
  assert.equal(packUrlFor('/media/bgm/unknown', index), null, 'stem the pack lacks');
  assert.equal(packUrlFor('/media/bgm/act1', null), null, 'no index');
  assert.equal(packUrlFor('/assets/~nothex/x.png', index), '/assets/~nothex/x.png', 'a malformed segment is not a hash: unchanged');
  assert.equal(packUrlFor('/assets/~0123456789abcdef', index), '/assets/~0123456789abcdef', 'no path after the segment: unchanged');
  assert.equal(packUrlFor(42, index), null, 'non-string pathname');
  assert.equal(packUrlFor(null, index), null, 'missing pathname');
});

test('the pack decision survives a 0.2.6 hashed URL end to end', () => {
  const packSizes = { '/assets/char/avatar/x.png': 100 };
  const sizeTable = { '/assets/char/avatar/x.png': 100 };
  const hashed = '/assets/~0123456789abcdef/char/avatar/x.png';
  assert.equal(packUsableFor(hashed, packSizes, sizeTable), false, 'the raw hashed path matches no key');
  assert.equal(packUsableFor(packUrlFor(hashed), packSizes, sizeTable), true, 'via packUrlFor the pack serves it');
  assert.equal(packUsableFor(packUrlFor(hashed), packSizes, { '/assets/char/avatar/x.png': 123 }), false,
    'a size drift still bypasses the pack under the hashed URL');
});

test('mimeForUrl mirrors the static server for everything the pack stores', () => {
  assert.equal(mimeForUrl('/assets/char/avatar/x.png'), 'image/png');
  assert.equal(mimeForUrl('/assets/char/avatar/x.webp'), 'image/webp');
  assert.equal(mimeForUrl('/assets/audio/bgm/act1.mp3'), 'audio/mpeg');
  assert.equal(mimeForUrl('/assets/spine/op/x/front/x.skel'), 'application/octet-stream');
  assert.equal(mimeForUrl('/assets/spine/op/x/front/x.atlas'), 'text/plain; charset=utf-8');
  assert.equal(mimeForUrl('/fonts/fonts.css'), 'text/css; charset=utf-8');
  assert.equal(mimeForUrl('/fonts/bender-regular.woff2'), 'font/woff2');
  assert.equal(mimeForUrl('/assets/x.unknownext'), 'application/octet-stream');
  assert.equal(mimeForUrl('/assets/noext'), 'application/octet-stream');
});

test('absoluteUrl: page origin and worker origin produce the same cache keys', () => {
  assert.equal(absoluteUrl('/assets/a.png', 'http://localhost:3100'), 'http://localhost:3100/assets/a.png');
  assert.equal(absoluteUrl('/assets/a.png', 'http://localhost:3100/'), 'http://localhost:3100/assets/a.png');
  assert.equal(absoluteUrl('/fonts/f.css', 'https://covenant.w2321.top'), 'https://covenant.w2321.top/fonts/f.css');
  assert.equal(absoluteUrl('/media/bgm/act1', 'http://x.test'), 'http://x.test/media/bgm/act1');
});
