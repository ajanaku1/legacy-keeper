# Video decisions

## Voice

**Recommendation:** macOS Daniel voice, rendered locally and kept at its natural speed.

**Rationale:** No Gemini, Azure, or ElevenLabs credential is available. Local
speech keeps the narration deterministic and avoids blocking the submission.

**Override:** Replace files under `public/audio/` and update measured durations
in `src/constants.ts`.

## Motion

**Recommendation:** restrained standard crossfades and spring entrances.

**Rationale:** This is a security product. Real evidence should remain readable;
glitch, simulated cursor, and decorative shader components would compete with it.

**Override:** Change the transition presentation in `src/MainVideo.tsx`.

## Music

**Recommendation:** no background music.

**Rationale:** No licensed track or configured music provider is available. The
voice and evidence remain clear without one.

**Override:** Add a licensed track under `public/audio/` and mix it below voice.
