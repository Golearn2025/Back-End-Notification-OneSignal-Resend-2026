import { describe, expect, it, vi } from 'vitest';
import { NotificationProcessorService } from '../../src/modules/notifications/notification-processor.service.js';
import type { ICustomerAccountCreatedEmailSender } from '../../src/modules/providers/resend.provider.js';

describe('NotificationProcessorService', () => {
  it('creates email delivery and sends via Resend on success', async () => {
    process.env.PUBLIC_WEBSITE_URL = 'https://vantage-lane.com';
    const eventsRepository = {
      markEventDelivered: vi.fn(async () => undefined),
      markEventFailedRetryable: vi.fn(async () => undefined)
    };
    const deliveriesRepository = {
      createDelivery: vi.fn(async () => ({ id: 'del-1' })),
      markDeliverySending: vi.fn(async () => undefined),
      markDeliveryProviderAccepted: vi.fn(async () => undefined),
      markDeliveryFailedRetryable: vi.fn(async () => undefined)
    };
    const resend: ICustomerAccountCreatedEmailSender = {
      sendCustomerAccountCreatedEmail: vi.fn(async () => ({ providerMessageId: 'res_msg_1' })),
      sendBookingPaymentConfirmedEmail: vi.fn(async () => ({ providerMessageId: 'res_pay_1' }))
    };
    const processor = new NotificationProcessorService(
      eventsRepository as never,
      deliveriesRepository as never,
      resend
    );

    await processor.process({
      id: 'evt-1',
      organization_id: 'org-1',
      event_type: 'customer_account_created',
      source_module: 'identity',
      priority: 'normal',
      status: 'pending',
      customer_id: 'cus-1',
      payload: {
        customer_email: 'customer@example.com',
        customer_first_name: 'Test'
      }
    });

    expect(deliveriesRepository.createDelivery).toHaveBeenCalledTimes(1);
    expect(resend.sendCustomerAccountCreatedEmail).toHaveBeenCalledWith({
      to: 'customer@example.com',
      customerFirstName: 'Test',
      createdDate: expect.any(String),
      websiteUrl: 'https://vantage-lane.com',
      supportEmail: 'info@vantage-lane.com',
      supportPhone: '+44 20 4620 3131'
    });
    expect(deliveriesRepository.markDeliveryProviderAccepted).toHaveBeenCalledWith(
      'del-1',
      'res_msg_1',
      expect.objectContaining({
        provider: 'resend',
        template_alias: 'customer_account_created_v1',
        template_id: 'c27ab80b-22ef-4249-a5d1-f78ed1d72f8d'
      })
    );
    expect(eventsRepository.markEventDelivered).toHaveBeenCalledWith('evt-1');
    expect(eventsRepository.markEventFailedRetryable).not.toHaveBeenCalled();
  });

  it('uses variable fallbacks when payload fields are missing', async () => {
    const eventsRepository = {
      markEventDelivered: vi.fn(async () => undefined),
      markEventFailedRetryable: vi.fn(async () => undefined)
    };
    const deliveriesRepository = {
      createDelivery: vi.fn(async () => ({ id: 'del-2' })),
      markDeliverySending: vi.fn(async () => undefined),
      markDeliveryProviderAccepted: vi.fn(async () => undefined),
      markDeliveryFailedRetryable: vi.fn(async () => undefined)
    };
    const resend: ICustomerAccountCreatedEmailSender = {
      sendCustomerAccountCreatedEmail: vi.fn(async () => ({ providerMessageId: 'res_msg_2' })),
      sendBookingPaymentConfirmedEmail: vi.fn(async () => ({ providerMessageId: 'res_pay_2' }))
    };
    const processor = new NotificationProcessorService(
      eventsRepository as never,
      deliveriesRepository as never,
      resend
    );

    await processor.process({
      id: 'evt-fallback',
      organization_id: 'org-1',
      event_type: 'customer_account_created',
      source_module: 'identity',
      priority: 'normal',
      status: 'pending',
      customer_id: 'cus-1',
      payload: {
        customer_email: 'customer@example.com'
      }
    });

    expect(resend.sendCustomerAccountCreatedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        customerFirstName: 'there',
        supportEmail: 'info@vantage-lane.com',
        supportPhone: '+44 20 4620 3131'
      })
    );
  });

  it('marks failed_retryable on Resend failure', async () => {
    const eventsRepository = {
      markEventDelivered: vi.fn(async () => undefined),
      markEventFailedRetryable: vi.fn(async () => undefined)
    };
    const deliveriesRepository = {
      createDelivery: vi.fn(async () => ({ id: 'del-1' })),
      markDeliverySending: vi.fn(async () => undefined),
      markDeliveryProviderAccepted: vi.fn(async () => undefined),
      markDeliveryFailedRetryable: vi.fn(async () => undefined)
    };
    const resend: ICustomerAccountCreatedEmailSender = {
      sendCustomerAccountCreatedEmail: vi.fn(async () => {
        throw new Error('Resend send failed: status=422');
      }),
      sendBookingPaymentConfirmedEmail: vi.fn(async () => ({ providerMessageId: 'res_pay_1' }))
    };
    const processor = new NotificationProcessorService(
      eventsRepository as never,
      deliveriesRepository as never,
      resend
    );

    await processor.process({
      id: 'evt-1',
      organization_id: 'org-1',
      event_type: 'customer_account_created',
      source_module: 'identity',
      priority: 'normal',
      status: 'pending',
      customer_id: 'cus-1',
      payload: {
        customer_email: 'customer@example.com',
        customer_first_name: 'Test'
      }
    });

    expect(eventsRepository.markEventFailedRetryable).toHaveBeenCalled();
    expect(deliveriesRepository.markDeliveryFailedRetryable).toHaveBeenCalled();
    expect(eventsRepository.markEventDelivered).not.toHaveBeenCalled();
  });

  it('marks unsupported events as failed_retryable', async () => {
    const eventsRepository = {
      markEventDelivered: vi.fn(async () => undefined),
      markEventFailedRetryable: vi.fn(async () => undefined)
    };
    const deliveriesRepository = {
      createDelivery: vi.fn(async () => ({ id: 'del-1' })),
      markDeliverySending: vi.fn(async () => undefined),
      markDeliveryProviderAccepted: vi.fn(async () => undefined),
      markDeliveryFailedRetryable: vi.fn(async () => undefined)
    };
    const resend: ICustomerAccountCreatedEmailSender = {
      sendCustomerAccountCreatedEmail: vi.fn(),
      sendBookingPaymentConfirmedEmail: vi.fn()
    };
    const processor = new NotificationProcessorService(
      eventsRepository as never,
      deliveriesRepository as never,
      resend
    );

    await processor.process({
      id: 'evt-2',
      organization_id: 'org-1',
      event_type: 'booking_confirmed',
      source_module: 'booking',
      priority: 'normal',
      status: 'pending',
      customer_id: null,
      payload: {}
    });

    expect(eventsRepository.markEventFailedRetryable).toHaveBeenCalledTimes(1);
    expect(deliveriesRepository.createDelivery).not.toHaveBeenCalled();
    expect(resend.sendCustomerAccountCreatedEmail).not.toHaveBeenCalled();
  });

  it('sends payment_success_customer_v1 for booking_payment_confirmed', async () => {
    const eventsRepository = {
      markEventDelivered: vi.fn(async () => undefined),
      markEventFailedRetryable: vi.fn(async () => undefined)
    };
    const deliveriesRepository = {
      createDelivery: vi.fn(async () => ({ id: 'del-pay-1' })),
      markDeliverySending: vi.fn(async () => undefined),
      markDeliveryProviderAccepted: vi.fn(async () => undefined),
      markDeliveryFailedRetryable: vi.fn(async () => undefined)
    };
    const resend: ICustomerAccountCreatedEmailSender = {
      sendCustomerAccountCreatedEmail: vi.fn(async () => ({ providerMessageId: 'res_msg_1' })),
      sendBookingPaymentConfirmedEmail: vi.fn(async () => ({ providerMessageId: 'res_pay_1' }))
    };
    const processor = new NotificationProcessorService(
      eventsRepository as never,
      deliveriesRepository as never,
      resend
    );

    await processor.process({
      id: 'evt-pay-1',
      organization_id: 'org-1',
      event_type: 'booking_payment_confirmed',
      source_module: 'payment_smoke_test',
      priority: 'high',
      status: 'pending',
      customer_id: 'cus-1',
      payload: {
        customer_email: 'customer@example.com',
        customer_first_name: 'Catalin',
        invoice_number: 'INV-2026-0001',
        payment_date: '27 April 2026',
        payment_method: 'Visa •••• 4242',
        amount_paid: '145.00',
        currency: 'GBP',
        receipt_url: 'https://vantage-lane.com',
        booking_line_1_label: 'Booking Type',
        booking_line_1_value: 'One Way',
        booking_line_2_label: 'Reference',
        booking_line_2_value: 'CB-000576',
        booking_line_3_label: 'When',
        booking_line_3_value: '27 April 2026, 18:30',
        booking_line_4_label: 'Route',
        booking_line_4_value: 'A -> B',
        booking_line_5_label: 'Vehicle',
        booking_line_5_value: 'bmw-7-series',
        booking_line_6_label: 'Passengers/Luggage',
        booking_line_6_value: '2 / 1',
        context_source: 'app_notification_payment_success_context'
      }
    });

    expect(resend.sendBookingPaymentConfirmedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        customerFirstName: 'Catalin',
        paymentMethod: 'Visa •••• 4242',
        amountPaid: '145.00',
        currency: 'GBP',
        receiptUrl: 'https://vantage-lane.com',
        bookingLine1Label: 'Booking Type',
        bookingLine1Value: 'One Way',
        bookingLine2Label: 'Reference',
        bookingLine2Value: 'CB-000576',
        bookingLine3Label: 'When',
        bookingLine3Value: '27 April 2026, 18:30',
        bookingLine4Label: 'Route',
        bookingLine4Value: 'A -> B',
        bookingLine5Label: 'Vehicle',
        bookingLine5Value: 'bmw-7-series',
        bookingLine6Label: 'Passengers/Luggage',
        bookingLine6Value: '2 / 1'
      })
    );
    expect(deliveriesRepository.markDeliveryProviderAccepted).toHaveBeenCalledWith(
      'del-pay-1',
      'res_pay_1',
      expect.objectContaining({
        template_alias: 'payment_success_customer_v1',
        event_family: 'payment'
      })
    );
    expect(eventsRepository.markEventDelivered).toHaveBeenCalledWith('evt-pay-1');
  });

  it('fails safely when required payment variables are missing', async () => {
    const eventsRepository = {
      markEventDelivered: vi.fn(async () => undefined),
      markEventFailedRetryable: vi.fn(async () => undefined)
    };
    const deliveriesRepository = {
      createDelivery: vi.fn(async () => ({ id: 'del-pay-2' })),
      markDeliverySending: vi.fn(async () => undefined),
      markDeliveryProviderAccepted: vi.fn(async () => undefined),
      markDeliveryFailedRetryable: vi.fn(async () => undefined)
    };
    const resend: ICustomerAccountCreatedEmailSender = {
      sendCustomerAccountCreatedEmail: vi.fn(async () => ({ providerMessageId: 'res_msg_1' })),
      sendBookingPaymentConfirmedEmail: vi.fn(async () => ({ providerMessageId: 'res_pay_1' }))
    };
    const processor = new NotificationProcessorService(
      eventsRepository as never,
      deliveriesRepository as never,
      resend
    );

    await processor.process({
      id: 'evt-pay-2',
      organization_id: 'org-1',
      event_type: 'booking_payment_confirmed',
      source_module: 'payment_smoke_test',
      priority: 'high',
      status: 'pending',
      customer_id: 'cus-1',
      payload: {
        customer_email: 'customer@example.com',
        amount_paid: '145.00'
      }
    });

    expect(resend.sendBookingPaymentConfirmedEmail).not.toHaveBeenCalled();
    expect(deliveriesRepository.markDeliveryFailedRetryable).toHaveBeenCalled();
    expect(eventsRepository.markEventFailedRetryable).toHaveBeenCalled();
  });
});
