// Configuracion simple por cliente.
// Solo cambia estos valores y deja el resto igual.
window.APP_CONFIG = {
  APP_NAME: "Carrito Demo",
  FOOTER_TEXT: "Carrito Demo - App de ejemplo",
  LOGO_URL: "logo.png",

  // Importante: usar un prefijo distinto por cliente para no mezclar datos locales.
  STORAGE_PREFIX: "demo",

  // Admin por codigo (email de la cuenta admin en Supabase Auth).
  ADMIN_EMAIL: "admin@demo.app",

  // Supabase del cliente.
  SUPABASE_URL: "https://fhpzmobinplqialxubix.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZocHptb2JpbnBscWlhbHh1Yml4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNTI4MzQsImV4cCI6MjA4ODkyODgzNH0.g8h03e7T3NNxshpmnrFK6m07Lw1RecnMDg4TcxPgVfQ",

  // Productos por defecto (si la tabla products esta vacia).
  DEFAULT_PRODUCTS: [
    { sku: "cubanito_comun", name: "Cubanito comun", unit: "Unidad", prices: { presencial: 1000, pedidosya: 1300 } },
    { sku: "cubanito_negro", name: "Cubanito choco negro", unit: "Unidad", prices: { presencial: 1300, pedidosya: 1900 } },
    { sku: "cubanito_blanco", name: "Cubanito choco blanco", unit: "Unidad", prices: { presencial: 1300, pedidosya: 1900 } },
    { sku: "garrapinadas", name: "Garrapinadas", unit: "Bolsa", prices: { presencial: 1200, pedidosya: 1600 } },
  ],
};
