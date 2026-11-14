import Busboy from 'busboy';
import { parseBuffer } from 'music-metadata';

export const MAX_SPEECH_BYTES = 8 * 1024 * 1024;
export const MAX_SPEECH_SECONDS = 30;

const ALLOWED_AUDIO = new Map([
  ['audio/webm', 'webm'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/wave', 'wav'],
  ['audio/mpeg', 'mp3'],
  ['audio/mp3', 'mp3'],
  ['audio/ogg', 'ogg'],
  ['audio/mp4', 'm4a'],
  ['audio/x-m4a', 'm4a']
]);

function badRequest(code, message, status = 400) {
  return Object.assign(new Error(message), { status, code });
}

export async function readSpeechUpload(req, { parseMetadata = parseBuffer } = {}) {
  const length = Number(req.headers['content-length'] || 0);
  if (length > MAX_SPEECH_BYTES + 64 * 1024) {
    throw badRequest('audio_too_large', 'Recording is too large. Keep it under 8 MB.', 413);
  }

  const contentType = String(req.headers['content-type'] || '');
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw badRequest('multipart_required', 'Upload the recording as multipart form data.');
  }

  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({ headers: req.headers, limits: { fileSize: MAX_SPEECH_BYTES, files: 2, fields: 2, parts: 3, fieldSize: 8 } });
    } catch {
      reject(badRequest('invalid_audio_upload', 'The audio upload could not be read.'));
      return;
    }

    let failure = null;
    let audio = null;
    let mimeType = '';
    let language = '';
    let gotFile = false;
    let fileCount = 0;
    let fieldCount = 0;
    let fileFinished = false;
    let fieldFinished = false;

    parser.on('field', (name, value, info) => {
      fieldCount += 1;
      if (fieldCount > 1) failure ||= badRequest('invalid_audio_upload', 'The audio upload has too many fields.');
      if (name !== 'language' || language || info.valueTruncated) {
        failure ||= badRequest('invalid_audio_upload', 'The audio upload has invalid fields.');
        return;
      }
      language = value;
      fieldFinished = true;
    });

    parser.on('file', (name, stream, info) => {
      fileCount += 1;
      gotFile = true;
      if (fileCount > 1) {
        failure ||= badRequest('invalid_audio_upload', 'Upload only one recording.');
        stream.resume();
        return;
      }
      const normalizedType = String(info.mimeType || '').split(';', 1)[0].trim().toLowerCase();
      if (name !== 'audio' || !ALLOWED_AUDIO.has(normalizedType)) {
        failure ||= badRequest('unsupported_audio_format', 'Use WebM, WAV, MP3, or M4A audio.');
        stream.resume();
        return;
      }
      mimeType = normalizedType;
      const chunks = [];
      let size = 0;
      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size <= MAX_SPEECH_BYTES) chunks.push(chunk);
      });
      stream.on('limit', () => { failure ||= badRequest('audio_too_large', 'Recording is too large. Keep it under 8 MB.', 413); });
      stream.on('end', () => {
        fileFinished = true;
        if (!failure && size > 0) audio = Buffer.concat(chunks, size);
      });
    });

    parser.on('filesLimit', () => { failure ||= badRequest('invalid_audio_upload', 'Upload only one recording.'); });
    parser.on('fieldsLimit', () => { failure ||= badRequest('invalid_audio_upload', 'The audio upload has too many fields.'); });
    parser.on('partsLimit', () => { failure ||= badRequest('invalid_audio_upload', 'The audio upload has too many parts.'); });
    parser.on('error', () => { failure ||= badRequest('invalid_audio_upload', 'The audio upload could not be read.'); });
    parser.on('finish', async () => {
      if (failure) { reject(failure); return; }
      if (!fieldFinished || language === '' || !gotFile) { reject(badRequest('invalid_audio_upload', 'The recording and speech language are required.')); return; }
      if (!fileFinished) { reject(badRequest('invalid_audio_upload', 'The audio upload was incomplete.')); return; }
      if (!gotFile || !audio) { reject(badRequest('audio_required', 'A non-empty audio recording is required.')); return; }
      if (!['am', 'om', 'ti', 'en'].includes(language)) {
        reject(badRequest('unsupported_speech_language', 'Choose Amharic, Afaan Oromo, Tigrinya, or English for speech transcription.', 422));
        return;
      }
      try {
        const metadata = await parseMetadata(audio, { mimeType }, { duration: true });
        if (!Number.isFinite(metadata.format.duration) || metadata.format.duration <= 0) {
          reject(badRequest('invalid_audio', 'The recording duration could not be verified.', 422));
          return;
        }
        if (metadata.format.duration > MAX_SPEECH_SECONDS) {
          reject(badRequest('audio_too_long', 'Keep recordings to 30 seconds or less.', 413));
          return;
        }
      } catch (e) {
        if (e && e.status) { reject(e); return; }
        reject(badRequest('invalid_audio', 'The recording is invalid or its duration could not be read.', 422));
        return;
      }
      resolve({ audio, mimeType, language });
    });

    req.on('aborted', () => { failure ||= badRequest('upload_aborted', 'The recording upload was interrupted.'); });
    req.pipe(parser);
  });
}
