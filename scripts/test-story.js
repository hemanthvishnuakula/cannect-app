const { generateStoryImage } = require('./story-image');
generateStoryImage('at://did:plc:75x5kjjh32aunyomuh33nuh7/app.bsky.feed.post/3mdqmasmmtk2n')
  .then((r) => console.log('OK', r.length))
  .catch((e) => console.error('ERR', e.message, e.stack));
