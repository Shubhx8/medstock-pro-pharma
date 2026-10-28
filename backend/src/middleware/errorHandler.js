// Central error handling middleware mapping MySQL errors and custom exceptions
function errorHandler(err, req, res, next) {
  // MySQL Trigger Error (SIGNAL SQLSTATE '45000')
  if (err.sqlState === '45000') {
    return res.status(400).json({
      success: false,
      message: err.sqlMessage || 'Database validation rule violated'
    });
  }

  // Duplicate entry error
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(400).json({
      success: false,
      message: 'Duplicate entry'
    });
  }

  // Foreign key reference does not exist
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_NO_REFERENCED_ROW') {
    return res.status(400).json({
      success: false,
      message: 'Referenced record does not exist'
    });
  }

  // Record is referenced and cannot be deleted
  if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
    return res.status(400).json({
      success: false,
      message: 'Record is in use and cannot be deleted'
    });
  }

  // Check constraint violation
  if (err.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
    return res.status(400).json({
      success: false,
      message: 'Invalid value'
    });
  }

  // Explicit HTTP status error thrown in app logic
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message
    });
  }

  // Catch-all 500 Server Error
  console.error('[SERVER ERROR]:', err);
  return res.status(500).json({
    success: false,
    message: err.message || 'Server error'
  });
}

module.exports = errorHandler;
