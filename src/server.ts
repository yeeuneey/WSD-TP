import app from "./app";
import { env } from "./config/env";

const PORT = env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`🚀 GoGoStudy server is running on port ${PORT}`);
});