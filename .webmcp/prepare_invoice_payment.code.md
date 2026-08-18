```javascript
import { defineTool } from '@nekuda/webmcp';
import { erp } from '@/redux/erp/actions';
import { balanceDue, dispatch, goTo, money, resolveInvoice } from './runtime';
import { createIntent } from './payment_intents';

export const prepareInvoicePayment = defineTool({
  stableKey: 'billing.payments.prepare',
  name: 'prepare_invoice_payment',
  title: 'Check a payment before recording it',
  description:
    'Check a payment against an invoice before any money is recorded, and open that invoice so it is visible on screen. Use this first whenever you intend to record a payment: it confirms the invoice exists, computes the balance still due, rejects an amount above that balance, and returns a confirmation token. Nothing is written. Returns the invoice number, customer, currency, balance due, the amount that would be recorded, the balance that would remain, and the token that confirm_invoice_payment requires.',
  inputSchema: {
    type: 'object',
    properties: {
      number: {
        type: 'integer',
        description: 'The invoice number to pay against. Use with year.',
      },
      year: {
        type: 'integer',
        description: "The invoice's year. Defaults to the current year when a number is given.",
      },
      invoice_id: {
        type: 'string',
        description: "The invoice's id, if you already have it. Use instead of number and year.",
      },
      amount: {
        type: 'number',
        exclusiveMinimum: 0,
        description: 'The amount to record. Must be above 0 and no more than the balance due.',
      },
    },
    required: ['amount'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  async execute({ number, year, invoice_id, amount } = {}) {
    const requested = money(amount);
    if (!Number.isFinite(requested) || requested <= 0) {
      throw new Error('the payment amount must be above 0');
    }

    const invoice = await resolveInvoice({ invoice_id, number, year });
    const due = balanceDue(invoice);
    const label = `invoice ${invoice.number}/${invoice.year}`;

    if (due <= 0) {
      throw new Error(
        `${label} has nothing outstanding — it is already marked ${invoice.paymentStatus}`
      );
    }
    if (requested > due) {
      throw new Error(
        `${requested} is more than the ${due} still due on ${label} — this app will not accept an overpayment`
      );
    }

    // Put the invoice on screen so the person being acted for can see what is
    // about to be paid before the confirming call is made.
    await dispatch(erp.currentItem({ data: invoice }));
    goTo(`/invoice/read/${invoice._id}`);

    const token = createIntent({
      invoiceId: invoice._id,
      invoiceNumber: invoice.number,
      invoiceYear: invoice.year,
      clientId: invoice.client?._id || invoice.client,
      amount: requested,
    });

    return {
      token,
      invoice_number: invoice.number,
      invoice_year: invoice.year,
      customer: invoice.client?.name || null,
      currency: invoice.currency,
      balance_due: due,
      amount_to_record: requested,
      balance_after: money(due - requested),
      note: 'Nothing has been recorded yet. Confirm the amount, then call confirm_invoice_payment with this token.',
    };
  },
});
```
