import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getStorage, ref, uploadString, getDownloadURL } from 'firebase/storage';

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
    const blob = await response.blob();
    const storageRef = ref(storage, path);
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onloadend = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1];
          await uploadString(storageRef, base64Data, 'base64');
          const downloadUrl = await getDownloadURL(storageRef);
          resolve(downloadUrl);
        } catch (error) {
          console.error('Error uploading image:', error);
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error fetching image:', error);
    return null;
  }
}

// Upload Telegram photo to Firebase Storage
async function uploadTelegramPhoto(fileId: string, botToken: string, path: string): Promise<string | null> {
  try {
    // Get file path from Telegram
    const fileResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const fileData = await fileResponse.json();
    if (!fileData.ok) throw new Error(fileData.description);

    const filePath = fileData.result.file_path;
    const imageUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

    // Upload using existing function
    return await uploadImageFromUrl(imageUrl, path);
  } catch (error) {
    console.error('Error uploading Telegram photo:', error);
    return null;
  }
}

export { db, collection, addDoc, auth, storage, uploadImageFromUrl, uploadTelegramPhoto };
