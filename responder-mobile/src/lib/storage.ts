import AsyncStorage from "@react-native-async-storage/async-storage";

const CAD_TOKEN_KEY = "cad_token";
const CAD_USER_KEY = "cad_user";

export type MobileUser = {
  id: string;
  name: string;
  /** Login username saved at sign-in for display in Settings. */
  username?: string;
  callsign?: string;
  unit?: string;
};

export async function getCadToken(): Promise<string | null> {
  return AsyncStorage.getItem(CAD_TOKEN_KEY);
}

export async function setCadToken(token: string): Promise<void> {
  await AsyncStorage.setItem(CAD_TOKEN_KEY, token);
}

export async function clearCadAuth(): Promise<void> {
  await AsyncStorage.multiRemove([CAD_TOKEN_KEY, CAD_USER_KEY]);
}

export async function getCadUser(): Promise<MobileUser | null> {
  const raw = await AsyncStorage.getItem(CAD_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MobileUser;
  } catch {
    return null;
  }
}

export async function setCadUser(user: MobileUser): Promise<void> {
  await AsyncStorage.setItem(CAD_USER_KEY, JSON.stringify(user));
}

