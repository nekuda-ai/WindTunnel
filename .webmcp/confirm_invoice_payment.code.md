```javascript
import { defineTool } from '@nekuda/webmcp';
import { erp } from '@/redux/erp/actions';
import { request } from '@/request';
import { asDateOnly, balanceDue, dispatch, goTo, money, unwrap } from './runtime';
import { claimIntent } from './payment_intents';

async function nextPaymentNumber() {
  // Number from the record count rather than by sorting: the list endpoint takes
  // its sort direction off the query string and rejects it as a string. Payment
  // numbers are not unique-constrained here (the app's own form just defaults to
  // 1), so a count-derived number is the same guarantee the app already gives.
  const response = await request.list({ entity: 'payment', options: { page: 1, items: 1 } });
  unwrap(response, 'reading the payment numbering');
  return (response.pagination?.count ?? 0) + 1;
}

export const confirmInvoicePayment = defineTool({
  stableKey: 'billing.payments.confirm',
  name: 'confirm_invoice_payment',
  title: 'Record a payment',
  description:
    'Record the payment that prepare_invoice_payment quoted, using the token it returned. This writes a payment against the invoice, increases the amount credited, and moves the invoice to partially paid or paid — it is a money movement in the books and there is no undo tool, so only call it once the amount has been confirmed with the person you are acting for. The token is single-use and valid only for the invoice and amount that were quoted. Returns the recorded payment\'s id and number, and the invoice\'s new credited amount, remaining balance, and payment status.',
  inputSchema: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        description: 'The confirmation token returned by prepare_invoice_payment.',
      },
      reference: {
        type: 'string',
        description: 'Payment reference, such as a bank transfer or cheque number.',
      },
      description: { type: 'string', description: 'Free-text note stored with the payment.' },
      date: {
        type: 'string',
        description: 'Date the payment was received, as YYYY-MM-DD. Defaults to today.',
      },
    },
    required: ['token'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false },
  async execute({ token, reference, description, date } = {}) {
    const intent = claimIntent(token);

    // Re-read the invoice rather than trusting the quote: another user or an
    // earlier call may have moved the balance since the token was issued.
    const invoice = unwrap(
      await request.read({ entity: 'invoice', id: intent.invoiceId }),
      `re-reading invoice ${intent.invoiceNumber}/${intent.invoiceYear}`
    );
    const due = balanceDue(invoice);
    if (intent.amount > due) {
      throw new Error(
        `the balance on invoice ${invoice.number}/${invoice.year} has changed to ${due} since this payment was prepared — call prepare_invoice_payment again`
      );
    }

    const jsonData = {
      number: await nextPaymentNumber(),
      date: asDateOnly(date, 'date') || new Date().toISOString(),
      amount: intent.amount,
      invoice: invoice._id,
      client: invoice.client?._id || invoice.client,
    };
    if (reference) jsonData.ref = String(reference);
    if (description) jsonData.description = String(description);

    const payment = unwrap(
      await request.create({ entity: 'payment', jsonData }),
      `recording a payment against invoice ${invoice.number}/${invoice.year}`
    );

    // The app's own record-payment screen ends by refreshing the invoice list and
    // returning to it; do the same so the new figures are on screen.
    await dispatch(erp.list({ entity: 'invoice' }));
    goTo('/invoice');

    const credited = money((invoice.credit || 0) + intent.amount);
    const remaining = money(due - intent.amount);

    return {
      payment: {
        id: payment._id,
        number: payment.number,
        amount: money(payment.amount),
        date: payment.date,
        reference: payment.ref || null,
      },
      invoice: {
        id: invoice._id,
        number: invoice.number,
        year: invoice.year,
        customer: invoice.client?.name || null,
        total: money(invoice.total),
        paid: credited,
        balance_due: remaining,
        payment_status: remaining === 0 ? 'paid' : 'partially',
      },
    };
  },
});
```
