```javascript
import { defineTool } from '@nekuda/webmcp';
import { request } from '@/request';
import { money, unwrap } from './runtime';

const PERIODS = ['week', 'month', 'year'];

export const getFinanceSummary = defineTool({
  stableKey: 'billing.summary.get',
  name: 'get_finance_summary',
  title: 'Finance summary',
  description:
    'Return the headline finance numbers for the whole book: total invoiced, total still outstanding, invoice counts and percentages by status, and how many customers are new or active. Use this to answer questions like how much are we owed or how are we doing this month, without paging through the invoice list. Takes an optional period of week, month, or year for the customer figures. Returns the totals, the per-status breakdown, and the period used.',
  inputSchema: {
    type: 'object',
    properties: {
      period: {
        type: 'string',
        enum: PERIODS,
        default: 'month',
        description: 'The window used for the new and active customer figures.',
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  async execute({ period } = {}) {
    const type = period || 'month';

    const [invoices, customers] = await Promise.all([
      request.summary({ entity: 'invoice', options: { type } }),
      request.summary({ entity: 'client', options: { type } }),
    ]);

    const invoiceSummaryResult = unwrap(invoices, 'reading the invoice summary');
    const customerSummaryResult = unwrap(customers, 'reading the customer summary');

    return {
      period: type,
      total_invoiced: money(invoiceSummaryResult.total),
      total_outstanding: money(invoiceSummaryResult.total_undue),
      invoices_by_status: (invoiceSummaryResult.performance || []).map((entry) => ({
        status: entry.status,
        count: entry.count,
        percentage: entry.percentage,
      })),
      customers: {
        new_percentage: customerSummaryResult.new,
        active_percentage: customerSummaryResult.active,
      },
    };
  },
});
```
