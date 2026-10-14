import { createApp, mountOpenApi } from './bootstrap.js';
import { APP_CONFIG, type AppConfig } from './core/config/config.js';

const app = await createApp();
mountOpenApi(app);
const config = app.get<AppConfig>(APP_CONFIG);
await app.listen(config.PORT, '0.0.0.0');
