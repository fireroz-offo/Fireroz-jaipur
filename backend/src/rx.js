// Prescription validation + approval workflow
export function validateRx(d) {
  const errs = [];
  if (!d.diagnosis) errs.push('Diagnosis required');
  if (!Array.isArray(d.medicines) || !d.medicines.length) errs.push('Add at least one medicine');
  (d.medicines || []).forEach((m, i) => {
    const n = `Medicine ${i + 1}`;
    if (!m.name) errs.push(`${n}: name required`);
    if (!m.strength) errs.push(`${n}: strength required`);
    if (!m.dosage) errs.push(`${n}: dosage required`);
    if (!(Number(m.duration_days) > 0)) errs.push(`${n}: duration must be > 0 days`);
    if (!m.start_date) errs.push(`${n}: start date required`);
    const slots = ['morning', 'afternoon', 'night'].filter(s => m[s]);
    if (!slots.length) errs.push(`${n}: choose at least one time (morning/afternoon/night)`);
    if (Number(m.times_per_day) && Number(m.times_per_day) !== slots.length)
      errs.push(`${n}: frequency (${m.times_per_day}/day) does not match selected times (${slots.length})`);
    if (!['before_food', 'after_food', 'any'].includes(m.food || 'any')) errs.push(`${n}: invalid food instruction`);
  });
  return errs;
}
