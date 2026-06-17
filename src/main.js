import { analyticsPromise, app, auth, db, firebaseProject, storage } from "./firebase.js";

window.calledToBuildFirebase = {
  app,
  auth,
  db,
  storage,
  analyticsPromise,
  project: firebaseProject,
};
