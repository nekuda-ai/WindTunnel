```javascript
/* ----------------------------------------------------------------------------
 * Easy!Appointments - Online Appointment Scheduler
 *
 * @package     EasyAppointments
 * @author      A.Tselegidis <alextselegidis@gmail.com>
 * @copyright   Copyright (c) Alex Tselegidis
 * @license     https://opensource.org/licenses/GPL-3.0 - GPLv3
 * @link        https://easyappointments.org
 * ---------------------------------------------------------------------------- */

/**
 * WebMCP tool: cancel_appointment.
 *
 * Cancelling deletes the appointment for good, so the tool never does it in a single call: the first
 * call only reports what would go and mints a short-lived token, and only a second call carrying that
 * token submits the site's own cancellation form.
 */

import {defineTool} from '@nekuda/webmcp';
import {findService, isManageMode, pageVar} from './support.js';

const TOKEN_TTL_SECONDS = 300;

/**
 * The pending cancellation this page has prepared, if any.
 *
 * Module scope, so the token dies with the page it was minted on and can never be replayed.
 *
 * @type {{token: String, expiresAt: Number, reason: String, hash: String}|null}
 */
let pending = null;

/**
 * Mint an unguessable, short-lived confirmation token.
 *
 * @return {String} Returns the token.
 */
function mintToken() {
    const bytes = new Uint8Array(16);

    crypto.getRandomValues(bytes);

    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The site's own cancellation form, which only exists while cancelling is permitted.
 *
 * @return {HTMLFormElement} Returns the form element.
 */
function cancellationForm() {
    const form = document.getElementById('cancel-appointment-form');

    if (!form) {
        throw new Error(
            "This page is not offering a cancellation. Open the appointment's own reschedule link; the business " +
                'also locks cancellation shortly before the appointment starts.',
        );
    }

    return form;
}

/**
 * Describe the appointment the page is showing.
 *
 * @return {Object} Returns the appointment summary.
 */
function appointmentSummary() {
    const appointment = pageVar('appointment_data');
    const provider = pageVar('provider_data');
    const customer = pageVar('customer_data');
    const service = findService(appointment.id_services);

    return {
        appointment_hash: appointment.hash,
        service: service.name,
        provider: provider ? `${provider.first_name} ${provider.last_name}`.trim() : null,
        customer: customer ? `${customer.first_name} ${customer.last_name}`.trim() : null,
        start_datetime: appointment.start_datetime,
        end_datetime: appointment.end_datetime,
    };
}

export const cancelAppointment = defineTool({
    stableKey: 'booking.appointment.cancel',
    name: 'cancel_appointment',
    title: 'Cancel this appointment',
    description:
        "Cancel the appointment shown on this page and remove it from the business's schedule. This cannot be " +
        'undone, so it takes two calls: call it with a reason and no token to get back exactly what will be ' +
        'cancelled plus a short-lived confirmation_token, then call it again with that same token to actually ' +
        "cancel. Only available on an appointment's own reschedule page, where the appointment is already fixed. " +
        'Cancelling emails the customer and the provider, and the page then shows the cancellation notice.',
    inputSchema: {
        type: 'object',
        properties: {
            reason: {
                type: 'string',
                description: 'Why the appointment is being cancelled. The business requires one.',
                minLength: 1,
            },
            confirmation_token: {
                type: 'string',
                description:
                    'Leave this out on the first call. Pass back the token that call returned to actually cancel.',
            },
        },
        required: ['reason'],
        additionalProperties: false,
    },
    annotations: {readOnlyHint: false, untrustedContentHint: false},
    async execute({reason, confirmation_token: confirmationToken}) {
        if (!isManageMode()) {
            throw new Error(
                'There is no appointment on this page to cancel. Open the reschedule link from the booking ' +
                    'confirmation email first.',
            );
        }

        const form = cancellationForm();
        const summary = appointmentSummary();
        const trimmedReason = reason.trim();

        if (!trimmedReason) {
            throw new Error('The business requires a reason for the cancellation.');
        }

        if (!confirmationToken) {
            pending = {
                token: mintToken(),
                expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000,
                reason: trimmedReason,
                hash: summary.appointment_hash,
            };

            return {
                cancelled: false,
                will_cancel: summary,
                reason: trimmedReason,
                confirmation_token: pending.token,
                expires_in_seconds: TOKEN_TTL_SECONDS,
                note:
                    'Nothing has been cancelled yet. Check this is the right appointment with the visitor, then ' +
                    'call cancel_appointment again with this confirmation_token to go through with it.',
            };
        }

        if (!pending || pending.token !== confirmationToken) {
            throw new Error(
                'That confirmation token is not the one this page issued. Call cancel_appointment again without a ' +
                    'token to get a fresh summary and token.',
            );
        }

        if (Date.now() > pending.expiresAt) {
            pending = null;

            throw new Error(
                `That confirmation token expired after ${TOKEN_TTL_SECONDS} seconds. Call cancel_appointment again ` +
                    'without a token to get a fresh one.',
            );
        }

        if (pending.hash !== summary.appointment_hash) {
            pending = null;

            throw new Error('The page is showing a different appointment than the one that token was issued for.');
        }

        const cancelledReason = pending.reason;

        // Single use: the token is burnt before the form goes, so a repeat call can never re-fire it.
        pending = null;

        form.querySelector('#hidden-cancellation-reason').value = cancelledReason;
        form.submit();

        return {
            cancelled: true,
            appointment_hash: summary.appointment_hash,
            cancelled_appointment: summary,
            reason: cancelledReason,
            note: 'The page is now loading the cancellation notice.',
        };
    },
});
```
