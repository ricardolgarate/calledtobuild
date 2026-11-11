(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const dialog = $('#claim-dialog');
  const form = $('#claim-form');
  const submit = $('#submit-claim');
  const fields = {
    referralCode: $('#referral-code'),
    firstName: $('#first-name'),
    lastName: $('#last-name'),
    phone: $('#phone')
  };
  const errorFields = {
    referralCode: $('#referral-code-error'),
    firstName: $('#first-name-error'),
    lastName: $('#last-name-error'),
    phone: $('#phone-error')
  };
  const suppliedCode = new URL(window.location.href).searchParams.get('code');
  if (suppliedCode) fields.referralCode.value = suppliedCode.trim().slice(0,80);
  let sending = false;
  let lastSubmission = null;
  let returnFocus = null;
  let complete = false;

  function clearError(field) {
    fields[field].removeAttribute('aria-invalid');
    errorFields[field].textContent = '';
    errorFields[field].hidden = true;
  }
  function fieldError(field, message) {
    fields[field].setAttribute('aria-invalid', 'true');
    errorFields[field].textContent = message;
    errorFields[field].hidden = false;
  }
  function showFormError(message) {
    $('#form-error').textContent = message;
    $('#form-error').hidden = false;
  }
  function closeDialog() { dialog.close(); }
  document.querySelectorAll('[data-claim]').forEach(button => button.addEventListener('click', () => {
    returnFocus = button;
    dialog.showModal();
    document.body.classList.add('modal-open');
    if (complete) $('#claim-success').focus();
  }));
  $('.close-dialog').addEventListener('click', closeDialog);
  $('.done-button').addEventListener('click', closeDialog);
  dialog.addEventListener('close', () => {
    document.body.classList.remove('modal-open');
    returnFocus?.focus();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if(event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog();
  });
  Object.entries(fields).forEach(([name, input]) => input.addEventListener('input', () => clearError(name)));

  function submissionKey(serialized) {
    if (lastSubmission?.serialized === serialized) return lastSubmission.key;
    const key = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    lastSubmission = { serialized, key };
    return key;
  }
  function showSuccess(duplicate) {
    complete = true;
    $('#claim-content').hidden = true;
    $('#claim-success').hidden = false;
    if (duplicate) {
      $('#success-heading').innerHTML = 'Your request<br><em>is already with us.</em>';
      $('#success-message').textContent = 'OAB already has your request. We’ll contact you to confirm your free in-person visit. No need to send it again.';
    }
    $('#claim-success').focus();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || complete) return;
    Object.keys(fields).forEach(clearError);
    $('#form-error').hidden = true;
    const payload = {
      referralCode: fields.referralCode.value.trim(),
      firstName: fields.firstName.value.trim(),
      lastName: fields.lastName.value.trim(),
      phone: fields.phone.value.trim()
    };
    let valid = true;
    for (const name of ['referralCode', 'firstName', 'lastName']) {
      if (!payload[name]) {
        fieldError(name, name === 'referralCode' ? 'Add the referral code from your friend.' : `Add your ${name === 'firstName' ? 'first' : 'last'} name.`);
        valid = false;
      }
    }
    const digits = payload.phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15 || /[A-Za-z]/.test(payload.phone)) {
      fieldError('phone', 'Add a phone number with 10 to 15 digits.');
      valid = false;
    }
    if (!valid) {
      Object.values(fields).find(input => input.getAttribute('aria-invalid') === 'true')?.focus();
      return;
    }
    const normalized = {...payload, phone: digits};
    const key = submissionKey(JSON.stringify(normalized));
    sending = true;
    submit.disabled = true;
    submit.textContent = 'Sending your request…';
    form.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/referrals', {
        method: 'POST',
        headers: {'Content-Type':'application/json', 'Idempotency-Key':key},
        body: JSON.stringify(normalized),
        credentials: 'same-origin'
      });
      let result;
      try { result = await response.json(); } catch { result = null; }
      const duplicate = result?.duplicate === true || result?.saved === true;
      if ((response.ok && result?.ok === true) || (response.status === 409 && duplicate)) {
        showSuccess(duplicate);
        return;
      }
      const serverMessage = typeof result?.message === 'string' && result.message.length <= 300 ? result.message : null;
      const field = result?.field;
      if (response.status === 400 && Object.hasOwn(fields, field)) {
        fieldError(field, serverMessage || (field === 'referralCode' ? 'Please check your referral code and try again.' : 'Please check this detail and try again.'));
        fields[field].focus();
      } else if (response.status === 400 && /referral|code/i.test(String(result?.error || ''))) {
        fieldError('referralCode', serverMessage || 'Please check your referral code and try again.');
        fields.referralCode.focus();
      } else if (response.status === 429) {
        showFormError('Please wait a moment, then try again. Your details are still here.');
      } else {
        showFormError(serverMessage || 'We could not send your request. Please try again. Your details are still here.');
      }
    } catch {
      showFormError('We could not send your request. Check your connection and try again. Your details are still here.');
    } finally {
      sending = false;
      submit.disabled = false;
      submit.innerHTML = 'Request my free visit <span aria-hidden="true">↗</span>';
      form.removeAttribute('aria-busy');
    }
  });

  const primaryButton = $('.claim-button');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => {
      const hasPassed = entry.boundingClientRect.bottom < 0;
      $('.mobile-bar').classList.toggle('is-visible', !entry.isIntersecting && hasPassed);
    }, {threshold:0});
    observer.observe(primaryButton);
  }
})();
