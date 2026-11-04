document.addEventListener("DOMContentLoaded", () => {
    const logado = localStorage.getItem("isLoggedIn")

    if (!logado) {
        alert("Você precisa fazer login primeiro!")
        window.location.href = "login.html"
    }
})