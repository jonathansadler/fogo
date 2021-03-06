const { adminUtil, collectionsUtil } = require('../utils');
const exifParser = require('exif-parser');

module.exports = ({ environment }) => async data => {
  const file = data;
  const { md5Hash: md5WithSlashes, name, resourceState } = file;
  const md5Hash = md5WithSlashes.replace(/[+/]/g, '|');
  const path = name.split('/');

  if (shouldSkip(path)) {
    return { skipped: true };
  } else {
    const admin = adminUtil(environment);
    const doc = getDoc({ admin, environment, md5Hash, path });
    const file = getFile(admin, name);
    let result;

    if (resourceState == 'not_exists') {
      result = await deleteFile(admin, doc);
    } else {
      const exif = await getExif(file);
      const payload = await getPayload(file, environment.env, exif, path);

      await doc.set(payload, { merge: true });

      result = payload;
    }

    return result;
  }
};

function getDoc({ admin, environment, md5Hash, path }) {
  const uploads = collectionsUtil(environment).get('uploads');
  const root = path[0];
  return admin
    .firestore()
    .collection(uploads)
    .doc(`${root}-${md5Hash}`);
}

function getFile(admin, name) {
  return admin
    .storage()
    .bucket()
    .file(name);
}

function shouldSkip(path) {
  return path.includes('test') || !path.includes('uploads');
}

function getExif(file) {
  return file.download({ start: 0, end: 1024 }).then(([buffer]) => {
    let exif = {};
    try {
      exif = exifParser.create(buffer).parse();
    } catch (e) {
      console.log('exif parsing error', e);
    }
    return exif;
  });
}
function getPayload(file, env, exif, path) {
  const environment = path[0];
  const created = Date.now();
  const filename = path[path.length - 1];
  const cleanedFile = {};

  for (const key in file) {
    const value = file[key];
    if (typeof file[key] == 'string') {
      cleanedFile[key] = value;
    }
  }

  const payload = {
    ...env,
    environment,
    created,
    filename,
    ...cleanedFile,
    metadata: file.metadata,
  };

  return mergeExif(payload, exif);
}

function mergeExif(payload, exif) {
  const { tags: exifTags } = exif;
  let merged = payload;

  if (exifTags && exifTags.CreateDate) {
    merged = Object.assign({ CreateDate: exifTags.CreateDate || Date.now(), exifTags }, payload);
  }
  return merged;
}

function deleteFile(admin, doc) {
  return doc
    .get()
    .then(doc => {
      const { versions } = doc.data();
      return Promise.all(
        Object.keys(versions || {})
          .map(key => versions[key])
          .map(version => {
            return admin
              .storage()
              .bucket()
              .file(version.name)
              .delete();
          })
      );
    })
    .catch(error => {
      console.error(error);
      return true;
    })
    .then(() => doc.delete());
}
