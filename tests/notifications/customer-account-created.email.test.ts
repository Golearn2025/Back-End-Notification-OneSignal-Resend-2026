import { describe, expect, it } from 'vitest';
import {
  buildCustomerAccountCreatedHtml,
  buildCustomerAccountCreatedText,
  getCustomerAccountCreatedSubject
} from '../../src/modules/notifications/templates/customer-account-created.email.js';

describe('customer_account_created email template', () => {
  it('uses the fixed subject', () => {
    expect(getCustomerAccountCreatedSubject()).toBe('Your Vantage Lane account has been created');
  });

  it('renders text with first name', () => {
    const t = buildCustomerAccountCreatedText('Alex');
    expect(t).toContain('Hello Alex,');
    expect(t).toContain('Your Vantage Lane account has been created successfully.');
    expect(t).toContain('Vantage Lane');
  });

  it('renders "there" when first name is missing or empty', () => {
    expect(buildCustomerAccountCreatedText(undefined)).toContain('Hello there,');
    expect(buildCustomerAccountCreatedText('  ')).toContain('Hello there,');
  });

  it('escapes HTML in first name in HTML body', () => {
    const html = buildCustomerAccountCreatedHtml('<script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
