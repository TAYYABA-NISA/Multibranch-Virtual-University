// validate(schema) checks req.body against a zod schema and answers 400 with the first problem.
export const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const issue = result.error.issues[0];
    return res.status(400).json({ error: `${issue.path.join('.') || 'input'}: ${issue.message}` });
  }
  req.body = result.data; // cleaned values (trimmed, typed)
  next();
};

// True when SQLite refused a duplicate (unique) value.
export const isDuplicate = (err) => /UNIQUE constraint failed/.test(err?.message || '');
