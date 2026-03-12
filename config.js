// Configuracion simple por cliente.
// Solo cambia estos valores y deja el resto igual.
window.APP_CONFIG = {
  APP_NAME: "Mi Carrito de Cubanitos",
  FOOTER_TEXT: "Mi Carrito de Cubanitos - App de Caja",
  LOGO_URL: "logo.png",

  // Importante: usar un prefijo distinto por cliente para no mezclar datos locales.
  STORAGE_PREFIX: "cliente_demo",

  // Admin por codigo (email de la cuenta admin en Supabase Auth).
  ADMIN_EMAIL: "admin@tu-negocio.com",

  // Supabase del cliente.
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  // Productos por defecto (si la tabla products esta vacia).
  DEFAULT_PRODUCTS: [
    { sku: "cubanito_comun", name: "Cubanito comun", unit: "Unidad", prices: { presencial: 1000, pedidosya: 1300 } },
    { sku: "cubanito_negro", name: "Cubanito choco negro", unit: "Unidad", prices: { presencial: 1300, pedidosya: 1900 } },
    { sku: "cubanito_blanco", name: "Cubanito choco blanco", unit: "Unidad", prices: { presencial: 1300, pedidosya: 1900 } },
    { sku: "garrapinadas", name: "Garrapinadas", unit: "Bolsa", prices: { presencial: 1200, pedidosya: 1600 } },
  ],
};
