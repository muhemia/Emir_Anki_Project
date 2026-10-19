try {
  const theme = localStorage.getItem("emir-theme");
  document.documentElement.dataset.theme =
    theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
} catch {}
