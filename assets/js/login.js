const form = document.getElementById("login-form")
const emailInput = document.getElementById("email")
const passwordInput = document.getElementById("password")

form.addEventListener("submit", (event) => {
    event.preventDefault()

    const email = emailInput.value.trim()
    const password = passwordInput.value.trim()

    if (email === "" || password === "") {
        alert("Por favor, preencha todos os campos!")
        return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (!emailRegex.test(email)) {
        alert("Por favor, insira um e-mail válido!")
        return
    }

    localStorage.setItem("isLoggedIn", "true")

    window.location.href = "dashboard.html"

})