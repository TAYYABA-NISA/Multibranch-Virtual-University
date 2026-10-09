import app from './app.js';
import { seed } from './seed.js';

seed();
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`ExamSlot API on http://localhost:${port}`));
