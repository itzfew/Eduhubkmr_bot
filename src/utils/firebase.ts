import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
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

// Retry logic for anonymous sign-in
async function signInWithRetry(attempts = 3, delay = 1000): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await signInAnonymously(auth);
      console.log('Signed in anonymously');
      return;
    } catch (error) {
      console.error(`Anonymous sign-in attempt ${i} failed:`, error);
      if (i === attempts) {
        console.error('Max retry attempts reached for anonymous sign-in');
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay * i)); // Exponential backoff
    }
  }
}

// Initialize anonymous sign-in
signInWithRetry()
  .catch((error) => {
    console.error('Anonymous sign-in failed after retries:', error);
  });

// Upload image from URL to Firebase Storage
async function uploadImageFromUrl(imageUrl: string, path: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const storageReference = storageRef(storage, path);
    await uploadBytes(storageReference, buffer);
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
    const fileResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const fileData = await fileResponse.json();
    if (!fileData.ok) throw new Error(`Telegram API error: ${fileData.description}`);

    const filePath = fileData.result.file_path;
    const imageUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

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
  query,
  where,
  getDocs,
  storage,
  storageRef,
  uploadImageFromUrl,
  uploadTelegramPhoto,
  deleteObject,
  realtimeDb,
  dbRef as ref,
  set,
  onValue,
  remove,
  off
};
