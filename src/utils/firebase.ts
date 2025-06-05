// src/utils/firebase.ts
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc } from 'firebase/firestore';

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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
const db = getFirestore(app);

export { db, collection, addDoc };
