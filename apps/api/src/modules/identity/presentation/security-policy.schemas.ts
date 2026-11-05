import {
  AccessRestrictionPolicySchema,
  PasswordPolicySchema,
  SecurityPolicySchema,
  SessionPolicySchema,
} from '@cube-track/shared';
import { z } from 'zod';

export const SecurityPolicyResponse = SecurityPolicySchema;

export const UpdateSecurityPolicyBody = z
  .object({
    password: PasswordPolicySchema.partial().optional(),
    session: SessionPolicySchema.partial().optional(),
    accessRestriction: AccessRestrictionPolicySchema.partial().optional(),
  })
  .strict();
