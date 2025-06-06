import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  setDoc,
  doc,
  getDocs,
  query,
  where
} from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getStorage, ref as storageRef, uploadString, getDownloadURL } from 'firebase/storage';
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
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);
const realtimeDb = getDatabase(app);

// Sign in anonymously on initialization
signInAnonymously(auth)
  .then(() => {
    console.log('Signed in anonymously');
  })
  .catch((error) => {
    console.error('Anonymous sign-in failed:', error);
  });

// Upload image from URL to Firebase Storage
async function uploadImageFromUrl(imageUrl: string, path: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString('base64');
    
    const storageReference = storageRef(storage, path);
    await uploadString(storageReference, base64Data, 'base64');
    const downloadUrl = await getDownloadURL(storageReference);
    return downloadUrl;
  } catch (error) {
    console.error('Error uploading image from URL:', error);
    return null;
  }
}

// Upload Telegram photo to Firebase Storage
async function uploadTelegramPhoto(fileId: string, botToken: string, path: string): Promise<string | null> {
  try {
    // Get file path from Telegram
    const fileResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const fileData = await fileResponse.json();
    if (!fileData.ok) throw new Error(`Telegram API error: ${fileData.description}`);

    const filePath = fileData.result.file_path;
    const imageUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

    // Upload image using uploadImageFromUrl
    return await uploadImageFromUrl(imageUrl, path);
  } catch (error) {
    console.error('Error uploading Telegram photo:', error);
    return null;
  }
}

export {
  db,
  collection,
  addDoc,
  setDoc,
  doc,
  getDocs,
  query,
  where,
  storage,
  uploadImageFromUrl,
  uploadTelegramPhoto,
  realtimeDb,
  dbRef as ref,
  set,
  onValue,
  remove,
  off
};
