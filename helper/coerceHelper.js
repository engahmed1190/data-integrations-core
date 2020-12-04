const moment = require('moment');

function coerceValue(value, dataType) {
  try {
    switch (dataType) {
      case 'String':
        return String(value);
      case 'Number': 
        return coerceNumberValue(value);
      case 'Boolean':
        return coerceBooleanValue(value);  
      case 'Date':
        return coerceDateValue(value);
      default:
        return value;  
    }
  } catch (error) {
    return value;
  }
}

function coerceNumberValue(value) {
  const formattedValue = Number(value);

  return !isNaN(formattedValue) ? formattedValue : null;
}

function coerceDateValue(value) {
  if (!value) {
    return value;
  }

  const formattedValue = moment(value).format('MM/DD/YYYY');

  return formattedValue !== 'Invalid date' ? formattedValue : value;
}

function coerceBooleanValue(value) {
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }

  return !!value;
}

module.exports = {
  coerceValue,
  coerceBooleanValue,
  coerceDateValue,
  coerceNumberValue,
};
