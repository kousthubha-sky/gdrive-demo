import { Router, type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { prisma } from "./db.js";
import { env, isProd } from "./env.js";
import { HttpError } from "./errors.js";

const COOKIE = "gd_session";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthUser = { id: string; email: string; name: string; avatarUrl: string | null };

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthUser;
  }
}

passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${env.APP_URL}/api/auth/google/callback`,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        // Lower-cased on the way in: sharing looks users up by email, and a
        // Workspace account can hand back mixed case that would never match.
        const email = profile.emails?.[0]?.value?.trim().toLowerCase();
        if (!email) return done(new Error("Google account has no email address"));

        // Key on googleId so a user keeps their files even if they change their
        // Google display name; email is kept in sync for share-by-email lookups.
        const user = await prisma.user.upsert({
          where: { googleId: profile.id },
          update: { email, name: profile.displayName || email, avatarUrl: profile.photos?.[0]?.value ?? null },
          create: {
            googleId: profile.id,
            email,
            name: profile.displayName || email,
            avatarUrl: profile.photos?.[0]?.value ?? null,
          },
        });
        done(null, user);
      } catch (err) {
        done(err as Error);
      }
    }
  )
);

function issueSession(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: "7d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) throw new HttpError(401, "Not signed in");

    let sub: unknown;
    try {
      sub = (jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload).sub;
    } catch {
      throw new HttpError(401, "Session expired, please sign in again");
    }
    // A token can verify and still carry no usable `sub`; that is a dead
    // session, not a server error, so it takes the same 401 as an expired one.
    if (typeof sub !== "string") {
      throw new HttpError(401, "Session expired, please sign in again");
    }

    const user = await prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, email: true, name: true, avatarUrl: true },
    });
    if (!user) throw new HttpError(401, "Account no longer exists");

    req.auth = user;
    next();
  } catch (err) {
    next(err);
  }
}

export const authRouter = Router();

authRouter.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"], session: false })
);

authRouter.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: `${env.WEB_URL}/?error=oauth_failed`,
  }),
  (req: Request, res: Response) => {
    const user = req.user as { id: string } | undefined;
    if (!user) return res.redirect(`${env.WEB_URL}/?error=oauth_failed`);
    issueSession(res, user.id);
    res.redirect(env.WEB_URL);
  },
  // A failure inside the verify callback (a database that is unreachable, say)
  // would otherwise fall through to the generic handler and show the user raw
  // JSON on a Google redirect URL. Send them back to the login screen instead.
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Google OAuth callback failed:", err);
    res.redirect(`${env.WEB_URL}/?error=oauth_failed`);
  }
);

authRouter.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req: Request, res: Response) => {
  res.json(req.auth);
});
