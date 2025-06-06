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
import { getAuth, signInAnonymously, User } from 'firebase/auth';
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

// Initialize anonymous authentication with retry logic
let currentUser: User | null = null;
async function initializeAuth(maxRetries = 3, delayMs = 1000): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempting anonymous sign-in (Attempt ${attempt}/${maxRetries})`);
      const userCredential = await signInAnonymously(auth);
      currentUser = userCredential.user;
      console.log('Signed in anonymously with UID:', currentUser.uid);
      return;
    } catch (error: any) {
      console.error(`Anonymous sign-in failed on attempt ${attempt}:`, {
        code: error.code,
        message: error.message,
        stack: error.stack
      });
      if (attempt < maxRetries && error.code === 'auth/network-request-failed') {
        console.log(`Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2; // Exponential backoff
      } else {
        throw error;
      }
    }
  }
}

// Initialize authentication in the background
let authInitialized = false;
const authPromise = initializeAuth().then(() => {
  authInitialized = true;
}).catch((error) => {
  console.error('Failed to initialize authentication:', error);
});

// Function to ensure authentication is initialized
async function ensureAuth(): Promise<void> {
  if (!authInitialized) {
    await authPromise;
  }
  if (!currentUser) {
    throw new Error('Authentication not initialized or failed');
  }
}

// Upload image from URL to Firebase Storage
async function uploadImageFromUrl(imageUrl: string, path: string): Promise<string | null> {
  try {
    await ensureAuth();
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString('base64');
    
    const storageReference = storageRef(storage, path);
    await uploadString(storageReference, base64Data, 'base64');
    const downloadUrl = await getDownloadURL(storageReference);
    return downloadUrl;
  } catch (error: any) {
    console.error('Error uploading image from URL:', {
      message: error.message,
      stack: error.stack
    });
    return null;
  }
}

// Upload Telegram photo to Firebase Storage
async function uploadTelegramPhoto(fileId: string, botToken: string, path: string): Promise<string | null> {
  try {
    await ensureAuth();
    const fileResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const fileData = await fileResponse.json();
    if (!fileData.ok) throw new Error(`Telegram API error: ${fileData.description}`);

    const filePath = fileData.result.file_path;
    const imageUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

    return await uploadImageFromUrl(imageUrl, path);
  } catch (error: any) {
    console.error('Error uploading Telegram photo:', {
      message: error.message,
      stack: error.stack
    });
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
  auth,
  storage,
  uploadImageFromUrl,
  uploadTelegramPhoto,
  realtimeDb,
  dbRef as ref,
  set,
  onValue,
  remove,
  off,
  currentUser,
  ensureAuth
};
