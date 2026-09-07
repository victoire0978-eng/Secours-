import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
  signOut,
  onAuthStateChanged,
  updateProfile,
  User,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { DownloadTask, AppSettings } from '../types';

export class AuthService {
  private static readonly GOOGLE_REDIRECT_ERROR_KEY = 'nlsbox_google_redirect_error';

  private static async saveGoogleUserProfile(user: User): Promise<void> {
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || user.email?.split('@')[0] || 'Utilisateur',
          photoURL: user.photoURL || null,
          lastLogin: Date.now(),
          createdAt: Date.now(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Could not record Google user in Firestore:', e);
    }
  }

  /**
   * Completes a Google redirect started when the browser blocked a popup.
   * The result is also checked after returning from the Firebase OAuth page.
   */
  static async completeGoogleRedirectSignIn(): Promise<void> {
    try {
      const result = await getRedirectResult(auth);
      if (result?.user) {
        await this.saveGoogleUserProfile(result.user);
      }
    } catch (error: any) {
      try {
        sessionStorage.setItem(
          this.GOOGLE_REDIRECT_ERROR_KEY,
          JSON.stringify({
            code: error?.code || '',
            message: error?.message || '',
          })
        );
      } catch {
        // Storage can be unavailable in a privacy-restricted browser.
      }
    }
  }

  static consumeGoogleRedirectError(): { code: string; message: string } | null {
    try {
      const raw = sessionStorage.getItem(this.GOOGLE_REDIRECT_ERROR_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(this.GOOGLE_REDIRECT_ERROR_KEY);
      const parsed = JSON.parse(raw);
      return {
        code: typeof parsed?.code === 'string' ? parsed.code : '',
        message: typeof parsed?.message === 'string' ? parsed.message : '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Listen to Firebase auth state changes with guaranteed persistence
   */
  static onAuthStateChanged(callback: (user: User | null) => void): () => void {
    // Ensure browser local persistence is applied
    try {
      setPersistence(auth, browserLocalPersistence).catch(() => {});
    } catch {}

    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Record last login in Firestore
        try {
          await setDoc(
            doc(db, 'users', user.uid),
            {
              uid: user.uid,
              email: user.email || null,
              displayName: user.displayName || user.email?.split('@')[0] || 'Utilisateur',
              photoURL: user.photoURL || null,
              lastLogin: Date.now(),
            },
            { merge: true }
          );
        } catch (e) {
          console.warn('Could not update user lastLogin:', e);
        }
      }
      callback(user);
    });
  }

  /**
   * Sign in directly with Google (Popup with account chooser)
   */
  static async loginWithGoogle(): Promise<User> {
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (e) {
      console.warn('Persistence error:', e);
    }

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
      const cred = await signInWithPopup(auth, provider);
      await this.saveGoogleUserProfile(cred.user);
      return cred.user;
    } catch (error: any) {
      const code = error?.code || '';
      const canUseRedirect =
        code === 'auth/popup-blocked' ||
        code === 'auth/operation-not-supported-in-this-environment' ||
        code === 'auth/web-storage-unsupported';

      if (canUseRedirect) {
        await signInWithRedirect(auth, provider);
        // The page navigates away. This keeps the return type correct if a
        // browser delays navigation for a moment.
        return await new Promise<User>(() => {});
      }

      throw error;
    }
  }

  /**
   * Log in existing user with Email & Password
   */
  static async login(email: string, pass: string): Promise<User> {
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (e) {
      console.warn('Persistence error:', e);
    }

    const cred = await signInWithEmailAndPassword(auth, email.trim(), pass);
    return cred.user;
  }

  /**
   * Register new user with Email & Password
   */
  static async register(email: string, pass: string, displayName?: string): Promise<User> {
    try {
      await setPersistence(auth, browserLocalPersistence);
    } catch (e) {
      console.warn('Persistence error:', e);
    }

    const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
    if (displayName && cred.user) {
      await updateProfile(cred.user, { displayName: displayName.trim() });
    }

    // Save profile record in Firestore
    try {
      await setDoc(
        doc(db, 'users', cred.user.uid),
        {
          uid: cred.user.uid,
          email: cred.user.email,
          displayName: displayName?.trim() || cred.user.email?.split('@')[0] || 'Utilisateur',
          createdAt: Date.now(),
          lastLogin: Date.now(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn('Could not create initial user record:', e);
    }

    return cred.user;
  }

  /**
   * Fetch user's cloud saved data (downloads, playlists, preferences)
   */
  static async getUserCloudData(uid: string): Promise<{
    downloads?: DownloadTask[];
    preferences?: Partial<AppSettings>;
  } | null> {
    try {
      const userRef = doc(db, 'users', uid);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        return {
          downloads: data.savedDownloads || undefined,
          preferences: data.savedPreferences || undefined,
        };
      }
    } catch (e) {
      console.warn('Could not fetch user cloud data:', e);
    }
    return null;
  }

  /**
   * Save user's data to cloud so nothing is lost even when changing device
   */
  static async saveUserCloudData(
    uid: string,
    data: {
      downloads?: DownloadTask[];
      preferences?: Partial<AppSettings>;
    }
  ): Promise<void> {
    try {
      const payload: Record<string, any> = {
        updatedAt: Date.now(),
      };
      if (data.downloads !== undefined) {
        // Sanitize localBlobUrl before saving to Firestore (do not store undefined)
        payload.savedDownloads = data.downloads.map((d) => {
          const { localBlobUrl, ...cleanDownload } = d;
          return cleanDownload;
        });
      }
      if (data.preferences !== undefined) {
        payload.savedPreferences = data.preferences;
      }

      await setDoc(doc(db, 'users', uid), payload, { merge: true });
    } catch (e) {
      console.warn('Could not sync user cloud data to Firestore:', e);
    }
  }

  /**
   * Log out
   */
  static async logout(): Promise<void> {
    await signOut(auth);
  }

  /**
   * Check if a specific user is banned
   */
  static async checkUserBanStatus(uid: string): Promise<{
    isBanned: boolean;
    bannedReason?: string;
    bannedAt?: number;
  }> {
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) {
        const data = snap.data();
        if (data.isBanned) {
          return {
            isBanned: true,
            bannedReason: data.bannedReason || 'Infraction aux règles d’utilisation',
            bannedAt: data.bannedAt || data.updatedAt || Date.now(),
          };
        }
      }
    } catch (e) {
      console.warn('Error checking ban status:', e);
    }
    return { isBanned: false };
  }
}

