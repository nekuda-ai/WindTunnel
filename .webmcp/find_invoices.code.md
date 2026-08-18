```javascript
import { defineTool } from '@nekuda/webmcp';
import { erp } from '@/redux/erp/actions';
import { dispatch, getState, goTo, invoiceSummary, resolveCustomer } from './runtime';

const PAYMENT_STATUSES = ['unpaid', 'partially', 'paid'];
const STATUSES = ['draft', 'pending', 'sent', 'refunded', 'cancelled', 'on hold'];

export const findInvoices = defineTool({
  stableKey: 'billing.invoices.find',
  name: 'find_invoices',
  title: 'Find invoices',
  description:
    'List and filter invoices — by payment status (unpaid, partially, paid), by workflow status (draft, pending, sent, refunded, cancelled, on hold), by customer, or by free text — and show the result in the invoice table. Use this to answer questions like which invoices are unpaid or what a given customer has been billed. Returns each invoice\'s id, number, year, customer name, date, expiry date, total, amount already credited, currency, status, and payment status, plus the total match count; returns an empty list with a note when nothing matches.',
  inputSchema: {
    type: 'object',
    properties: {
      payment_status: {
        type: 'string',
        enum: PAYMENT_STATUSES,
        description: 'Show only invoices with this payment status.',
      },
      status: {
        type: 'string',
        enum: STATUSES,
        description: 'Show only invoices with this workflow status.',
      },
      customer: {
        type: 'string',
        description: "Customer name or customer id; only that customer's invoices are returned.",
      },
      page: { type: 'integer', minimum: 1, default: 1, description: '1-based page number.' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        default: 10,
        description: 'How many invoices per page.',
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  async execute({ payment_status, status, customer, page, limit } = {}) {
    // The invoice list endpoint takes one filter field, exactly as the app's own
    // table does. Narrowing on two at once would quietly drop one of them, so ask
    // for a single filter and let the caller read the rest off the returned rows.
    const requested = [
      customer ? 'customer' : null,
      payment_status ? 'payment_status' : null,
      status ? 'status' : null,
    ].filter(Boolean);
    if (requested.length > 1) {
      throw new Error(
        `this app's invoice list filters on one field at a time, but ${requested.join(' and ')} were both given — filter by one and read the other off each returned invoice`
      );
    }

    const options = { page: page ?? 1, items: limit ?? 10 };
    let resolvedCustomer = null;

    if (customer) {
      resolvedCustomer = await resolveCustomer(customer);
      options.filter = 'client';
      options.equal = resolvedCustomer._id;
    } else if (payment_status) {
      options.filter = 'paymentStatus';
      options.equal = payment_status;
    } else if (status) {
      options.filter = 'status';
      options.equal = status;
    }

    goTo('/invoice');
    // The invoice table renders straight off this dispatch, so the page shows the
    // same filtered set the agent is reading.
    await dispatch(erp.list({ entity: 'invoice', options }));

    const { result, isSuccess } = getState().erp.list;
    if (!isSuccess) {
      throw new Error('finding invoices failed: the invoice list could not be loaded');
    }

    const invoices = (result?.items || []).map(invoiceSummary);
    const response = {
      invoices,
      total_matches: result?.pagination?.total ?? invoices.length,
      page: options.page,
    };
    if (resolvedCustomer) {
      response.customer = { id: resolvedCustomer._id, name: resolvedCustomer.name };
    }
    if (invoices.length === 0) {
      response.note = requested.length
        ? `No invoice matches that ${requested[0].replace('_', ' ')}.`
        : 'There are no invoices on file yet.';
    }
    return response;
  },
});
```
