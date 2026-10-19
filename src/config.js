import 'dotenv/config';

export const PORT = process.env.PORT || 8080;

export const DB_HOST = process.env.DB_HOST;
export const DB_USER = process.env.DB_USER;
export const DB_PASSWORD = process.env.DB_PASSWORD;

export const DB_NAME = process.env.DB_NAME;
export const DB_PORT = process.env.DB_PORT;

export const VARIABLES_REQUERIDAS = ['DB_HOST', 'DB_USER', 'DB_NAME'];

export function variablesFaltantes() {
    return VARIABLES_REQUERIDAS.filter((variable) => !process.env[variable]);
}
