import "./globals.css";

export const metadata = {
  title: "Juan Cuentas",
  description: "Panel de servicios para clientes"
};

export default function RootLayout({ children }) {
  return <html lang="es"><body>{children}</body></html>;
}
