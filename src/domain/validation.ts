import { z } from 'zod';
import { CATEGORIES, STAKE_OPTIONS_CENTS } from './types';
import { MAX_AMOUNT_CENTS } from './money';

export const stakeSchema = z.union(STAKE_OPTIONS_CENTS.map((v) => z.literal(v)) as unknown as [
  z.ZodLiteral<100>,
  z.ZodLiteral<200>,
  z.ZodLiteral<500>,
]);

export const dieSchema = z.number().int().min(1).max(6);
export const diceSchema = z.array(dieSchema).length(5);
export const heldSchema = z.array(z.boolean()).length(5);
export const categorySchema = z.enum(CATEGORIES);
export const uuidSchema = z.uuid();

export const createGameInput = z.object({
  roomId: uuidSchema,
  stakeCents: stakeSchema,
  idempotencyKey: uuidSchema,
});

export const confirmRollInput = z.object({
  gameId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  turnNo: z.number().int().min(1).max(26),
  dice: diceSchema,
  held: heldSchema,
});

export const scoreTurnInput = z.object({
  gameId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  turnNo: z.number().int().min(1).max(26),
  category: categorySchema,
  strike: z.boolean(),
});

export const reasonSchema = z.string().trim().min(3, 'Bitte einen Grund mit mindestens 3 Zeichen angeben.').max(300);

export const correctScoreInput = z.object({
  gameId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  playerId: uuidSchema,
  category: categorySchema,
  dice: diceSchema,
  strike: z.boolean(),
  reason: reasonSchema,
});

export const paymentInput = z.object({
  roomId: uuidSchema,
  playerId: uuidSchema,
  amountCents: z.number().int().min(1, 'Der Betrag muss größer als 0 sein.').max(MAX_AMOUNT_CENTS, 'Der Betrag ist zu hoch.'),
  note: z.string().trim().max(200).optional(),
  idempotencyKey: uuidSchema,
});

export const adjustmentInput = z.object({
  roomId: uuidSchema,
  playerId: uuidSchema,
  amountCents: z
    .number()
    .int()
    .refine((v) => v !== 0, 'Der Betrag darf nicht 0 sein.')
    .refine((v) => Math.abs(v) <= MAX_AMOUNT_CENTS, 'Der Betrag ist zu hoch.'),
  reason: reasonSchema,
  correctsEntryId: uuidSchema.nullable().optional(),
  idempotencyKey: uuidSchema,
});

export const playerProfileInput = z.object({
  playerId: uuidSchema,
  displayName: z.string().trim().min(1, 'Name darf nicht leer sein.').max(30),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Ungültige Farbe.'),
});

export const roomNameSchema = z.string().trim().min(1, 'Name darf nicht leer sein.').max(60);
export const inviteTokenSchema = z.string().regex(/^[0-9a-f]{48}$/, 'Ungültiger Einladungslink.');
