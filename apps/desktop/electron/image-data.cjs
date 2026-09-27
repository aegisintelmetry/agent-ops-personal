const INPUT_LIMIT = 2 * 1024 * 1024;
const OUTPUT_LIMIT = 4 * 1024 * 1024;
const { imageSize } = require('image-size');

function imageData(value, limit = INPUT_LIMIT) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4 + 40) throw new Error('image_invalid');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error('image_invalid');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > limit || bytes.toString('base64') !== match[2]) throw new Error('image_invalid');
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpeg'
    : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : '';
  if (!mime || mime !== match[1]) throw new Error('image_invalid');
  let dimensions;
  try { dimensions = imageSize(bytes); } catch { throw new Error('image_invalid'); }
  const { width, height } = dimensions;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 16000000) throw new Error('image_invalid');
  return { bytes, mime: `image/${mime}`, base64: match[2], extension: mime === 'jpeg' ? 'jpg' : mime };
}

function imageList(images, { output = false } = {}) {
  if (!Array.isArray(images) || images.length > (output ? 1 : 5)) throw new Error('image_invalid');
  for (const image of images) imageData(image, output ? OUTPUT_LIMIT : INPUT_LIMIT);
  return Object.freeze([...images]);
}

function openAIContent(message) {
  return message.images?.length ? [{ type: 'text', text: message.content }, ...message.images.map(url => ({ type: 'image_url', image_url: { url } }))] : message.content;
}

function geminiContents(messages) {
  return messages.map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [
    { text: message.content }, ...(message.images || []).map(value => { const image = imageData(value); return { inlineData: { mimeType: image.mime, data: image.base64 } }; }),
  ] }));
}

function generatedImages(result, gemini = false) {
  const values = gemini ? (result.candidates?.[0]?.content?.parts || []).filter(part => !part.thought && part.inlineData).map(part => `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`)
    : (result.data || []).map(part => `data:image/png;base64,${part.b64_json}`);
  if (values.length !== 1) throw new Error('image_missing');
  return imageList(values, { output: true });
}

module.exports = { INPUT_LIMIT, OUTPUT_LIMIT, imageData, imageList, openAIContent, geminiContents, generatedImages };
