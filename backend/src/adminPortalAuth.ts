import jwt from "jsonwebtoken";

type AdminPortalClaims = {
  sub: string;
  role: "admin";
  typ: "admin_portal";
  name: string;
};

const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "Admin@12345";

function getAdminUsername(): string {
  return (process.env.ADMIN_PORTAL_USERNAME || DEFAULT_ADMIN_USERNAME).trim();
}

function getAdminPassword(): string {
  return (process.env.ADMIN_PORTAL_PASSWORD || DEFAULT_ADMIN_PASSWORD).trim();
}

function getAdminJwtSecret(): string {
  return (process.env.ADMIN_PORTAL_JWT_SECRET || process.env.JWT_SECRET || "dev-insecure-secret").trim();
}

function getAdminJwtExpiresIn(): jwt.SignOptions["expiresIn"] {
  return (process.env.ADMIN_PORTAL_JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] | undefined) ?? "12h";
}

export function verifyAdminPortalCredentials(username: string, password: string): boolean {
  const expectedUser = getAdminUsername();
  const expectedPass = getAdminPassword();
  return username.trim() === expectedUser && password === expectedPass;
}

export function signAdminPortalToken(name = "Administrator"): string {
  const payload: AdminPortalClaims = {
    sub: "admin-portal",
    role: "admin",
    typ: "admin_portal",
    name,
  };
  return jwt.sign(payload, getAdminJwtSecret(), { expiresIn: getAdminJwtExpiresIn() });
}

export function verifyAdminPortalToken(token: string): AdminPortalClaims | null {
  try {
    const decoded = jwt.verify(token, getAdminJwtSecret()) as Partial<AdminPortalClaims>;
    if (decoded.typ !== "admin_portal" || decoded.role !== "admin" || !decoded.sub) return null;
    return decoded as AdminPortalClaims;
  } catch {
    return null;
  }
}

