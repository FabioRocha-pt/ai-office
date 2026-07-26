// Alternância claro/escuro, partilhada pelas páginas web.
//
// O tema é aplicado no <html> antes de o CSS pintar, para não haver
// um flash branco ao carregar com o tema escuro guardado.
(function () {
  const CHAVE = "ai-office-tema";

  function aplicar(tema) {
    document.documentElement.dataset.tema = tema;
    const btn = document.getElementById("tema-btn");
    if (btn) {
      btn.textContent = tema === "escuro" ? "☀" : "☾";
      btn.title = tema === "escuro" ? "Mudar para claro" : "Mudar para escuro";
      btn.setAttribute("aria-label", btn.title);
    }
  }

  function guardado() {
    try { return localStorage.getItem(CHAVE); } catch { return null; }
  }

  // Sem escolha feita, segue o sistema — é o que o utilizador já decidiu
  // uma vez e não devia ter de repetir aqui.
  const inicial = guardado()
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro");

  aplicar(inicial);

  document.addEventListener("DOMContentLoaded", () => {
    aplicar(document.documentElement.dataset.tema);

    const btn = document.getElementById("tema-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const novo = document.documentElement.dataset.tema === "escuro" ? "claro" : "escuro";
      try { localStorage.setItem(CHAVE, novo); } catch {}
      aplicar(novo);
      // As páginas com canvas (o escritório 3D) precisam de repintar
      window.dispatchEvent(new CustomEvent("tema-mudou", { detail: novo }));
    });
  });
})();
