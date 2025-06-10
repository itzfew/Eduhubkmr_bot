import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase, ref as dbRef, set, onValue, remove, off } from 'firebase/database';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDIWtVfoGIWQoRVe36v6g6S3slTRRYUAgk",
  authDomain: "quizes-3028d.firebaseapp.com",
  databaseURL: "https://quizes-3028d-default-rtdb.firebaseio.com",
  projectId: "quizes-3028d",
  storageBucket: "quizes-3028d.appspot.com",
  messagingSenderId: "624591251031",
  appId: "1:624591251031:web:e093472f24fdeb29fc2512",
  measurementId: "G-QMZK5Y6769"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const realtimeDb = getDatabase(app);

// Sign in anonymously on initialization
signInAnonymously(auth)
  .then(() => {
    console.log('Signed in anonymously');
  })
  .catch((error) => {
    console.error('Anonymous sign-in failed:', error);
  });

export {
  realtimeDb,
  dbRef as ref,
  set,
  onValue,
  remove,
  off
};
