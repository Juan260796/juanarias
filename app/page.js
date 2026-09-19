export default function Home() {
  return (
    <main className="page brandLanding">
      <section className="brandHero">
        <img className="brandLogo brandLogoHero" src="/logo.jpg" alt="Juan Cuentas Streaming AXM" />
        <div className="brandEyebrow">STREAMING · CLIENTES · SERVICIOS</div>
        <h1>JUAN <span>CUENTAS</span></h1>
        <p>Administra y consulta tus servicios desde un panel moderno, rápido y seguro.</p>
        <div className="roleCards">
          <a className="roleCard clientRole" href="/login">
            <span className="roleIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>
            </span>
            <span className="roleText"><b>Ingresar como cliente</b><small>Consulta tus servicios y vencimientos</small></span>
            <span className="roleArrow">›</span>
          </a>
          <a className="roleCard adminRole" href="/admin">
            <span className="roleIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7l-8-4Z"/><path d="m9 12 2 2 4-4"/></svg>
            </span>
            <span className="roleText"><b>Panel administrador</b><small>Gestiona clientes, cuentas y pedidos</small></span>
            <span className="roleArrow">›</span>
          </a>
        </div>
      </section>
    </main>
  );
}
