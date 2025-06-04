// src/utils/firebase.ts
import * as admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (!serviceAccount.project_id) {
      throw new Error('Service account JSON is missing project_id');
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
    throw new Error('Invalid Firebase service account configuration');
  }
}

const db = getFirestore();

// Export Firestore equivalents of Realtime Database functions
export { db, FieldValue };

// Firestore equivalents for Realtime Database operations
export const ref = (path: string) => db.collection(path); // Maps to Firestore collection
export const push = (collectionRef: any) => ({
  id: `q_${Math.random().toString(36).substr(2, 9)}`, // Generate unique ID like HTML code
  ref: collectionRef.doc(`q_${Math.random().toString(36).substr(2, 9)}`),
});
export const set = async (docRef: any, data: any) => await docRef.set(data);
export const onValue = async (collectionRef: any, callback: (data: any) => void) => {
  const snapshot = await collectionRef.get();
  const data = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
  callback(data);
};
export const remove = async (docRef: any) => await docRef.delete();
