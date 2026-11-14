/**
 * Safe mock target for automation / push / email dry tests.
 * Never broadcast — always pin to this driver unless explicitly overridden in non-prod.
 */
export const AUTOMATION_TEST_DRIVER = {
  email: 'test@vantage-lane.com',
  driverId: '1187555a-2e7a-4e06-9463-6c6ef8a9ddc9',
  organizationId: '9a5caade-4791-4860-93b5-12b1c4fa9830',
  authUserId: '6bccf7b2-4cef-40fe-8ba0-bd8a3f59d173',
  firstName: 'Catalin',
  lastName: 'Tomita'
} as const;

export const DOC_EXPIRY_DAYS = [30, 15, 1] as const;
export const JOB_REMINDER_MINUTES = [180, 60] as const;

export function buildDocExpiryPushCopy(input: {
  daysLeft: number;
  documentLabel: string;
  expiryDate: string;
}): { title: string; body: string; inbox_type: string; deep_link: string } {
  if (input.daysLeft <= 0) {
    return {
      title: 'Document expired',
      body: `Your ${input.documentLabel} has expired (${input.expiryDate}). Renew it in Documents — you cannot receive new jobs until it is approved.`,
      inbox_type: 'document_expired',
      deep_link: 'documents'
    };
  }
  if (input.daysLeft === 1) {
    return {
      title: 'Document expires tomorrow',
      body: `Your ${input.documentLabel} expires tomorrow (${input.expiryDate}). Upload a renewed document today or you will not be able to receive new jobs after it expires.`,
      inbox_type: 'document_required',
      deep_link: 'documents'
    };
  }
  if (input.daysLeft === 15) {
    return {
      title: 'Document expires in 15 days',
      body: `Your ${input.documentLabel} expires in 15 days (${input.expiryDate}). Renew it now in Documents to avoid losing job access.`,
      inbox_type: 'document_required',
      deep_link: 'documents'
    };
  }
  return {
    title: 'Document expires in 30 days',
    body: `Your ${input.documentLabel} expires in 30 days (${input.expiryDate}). Please renew it in Documents so you can keep receiving jobs.`,
    inbox_type: 'document_required',
    deep_link: 'documents'
  };
}

export function buildJobReminderPushCopy(input: {
  minutesBefore: number;
  pickupTime: string;
  fromShort: string;
  toShort: string;
}): { title: string; body: string; inbox_type: string; deep_link: string } {
  const route = `${input.fromShort} → ${input.toShort}`;
  if (input.minutesBefore <= 60) {
    return {
      title: 'Pickup in 1 hour',
      body: `Time to head out · ${input.pickupTime} · ${route}`,
      inbox_type: 'admin_message',
      deep_link: 'accepted'
    };
  }
  return {
    title: 'Pickup in 3 hours',
    body: `${input.pickupTime} · ${route}`,
    inbox_type: 'admin_message',
    deep_link: 'accepted'
  };
}

export function buildAccountStatusPushCopy(
  kind: 'approved' | 'rejected' | 'suspended' | 'reactivated'
): { title: string; body: string; inbox_type: string; deep_link: string } {
  switch (kind) {
    case 'approved':
      return {
        title: "You're approved",
        body: 'Your Vantage Lane account is active. You can go online and receive jobs.',
        inbox_type: 'account_approved',
        deep_link: 'notifications'
      };
    case 'rejected':
      return {
        title: 'Application not approved',
        body: 'Your application was not approved. Check Documents or message Support for next steps.',
        inbox_type: 'account_rejected',
        deep_link: 'notifications'
      };
    case 'suspended':
      return {
        title: 'Account suspended',
        body: 'Your account is suspended and you cannot receive new jobs. Contact Support if you need help.',
        inbox_type: 'system',
        deep_link: 'notifications'
      };
    case 'reactivated':
      return {
        title: 'Account reactivated',
        body: 'Your account is active again. You can receive jobs.',
        inbox_type: 'system',
        deep_link: 'notifications'
      };
  }
}

export function labelDocumentType(documentType: string): string {
  const map: Record<string, string> = {
    driving_licence: 'Driving licence',
    proof_of_identity: 'Proof of identity',
    pco_licence: 'PCO licence',
    electronic_counterpart: 'Electronic counterpart',
    insurance_certificate: 'Insurance certificate',
    mot_certificate: 'MOT certificate',
    phv_licence: 'PHV licence'
  };
  if (map[documentType]) return map[documentType];
  return documentType
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
