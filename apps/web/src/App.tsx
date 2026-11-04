import { Navigate, RouterProvider, createBrowserRouter, useNavigate } from "react-router";
import { DemoProvider, useDemo } from "./store";
import { Shell } from "./Shell";
import { Login, Register, Recover, Onboarding } from "./Auth";
import { Button, Empty, Skeleton } from "./ui";

function NotFound() {
  const navigate = useNavigate();
  return (
    <Empty
      title="Página não encontrada"
      text="Este endereço não faz parte da operação. Volte para o Dashboard para continuar."
      action={<Button onClick={() => navigate("/app")}>Abrir Dashboard</Button>}
    />
  );
}
function RouteError() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background p-6">
      <Empty
        title="Não foi possível carregar esta tela"
        text="Não foi possível concluir esta tela. Recarregue para sincronizar os dados com o servidor e tente novamente."
        action={<Button onClick={() => window.location.reload()}>Tentar novamente</Button>}
      />
    </div>
  );
}

function ProtectedShell() {
  const { authMode } = useDemo();
  if (authMode === "loading")
    return (
      <div className="p-8">
        <Skeleton />
      </div>
    );
  if (authMode === "anonymous") return <Navigate to="/" replace />;
  return <Shell />;
}
const router = createBrowserRouter([
  { path: "/", Component: Login, errorElement: <RouteError /> },
  { path: "/cadastro", Component: Register, errorElement: <RouteError /> },
  { path: "/recuperar", Component: Recover, errorElement: <RouteError /> },
  { path: "/onboarding", Component: Onboarding, errorElement: <RouteError /> },
  {
    path: "/app",
    Component: ProtectedShell,
    HydrateFallback: () => (
      <div className="p-8">
        <Skeleton />
      </div>
    ),
    errorElement: <RouteError />,
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import("./Dashboard")).Dashboard,
        }),
      },
      {
        path: "pacientes",
        lazy: async () => ({
          Component: (await import("./Patients")).Patients,
        }),
      },
      {
        path: "pacientes/:id",
        lazy: async () => ({
          Component: (await import("./Patients")).PatientProfile,
        }),
      },
      {
        path: "agenda",
        lazy: async () => ({
          Component: (await import("./Operations")).Agenda,
        }),
      },
      {
        path: "tratamentos",
        lazy: async () => ({
          Component: (await import("./Operations")).Treatments,
        }),
      },
      {
        path: "tratamentos/:id",
        lazy: async () => ({
          Component: (await import("./Operations")).TreatmentDetail,
        }),
      },
      {
        path: "orcamentos",
        lazy: async () => ({
          Component: (await import("./Operations")).Quotes,
        }),
      },
      {
        path: "financeiro",
        lazy: async () => ({
          Component: (await import("./Operations")).Finance,
        }),
      },
      {
        path: "configuracoes",
        lazy: async () => ({
          Component: (await import("./Settings")).Settings,
        }),
      },
      {
        path: "automacoes",
        element: <Navigate to="/app/configuracoes?secao=Automações" replace />,
      },
      { path: "relatorios", element: <Navigate to="/app" replace /> },
      { path: "estoque", element: <Navigate to="/app" replace /> },
      { path: "*", Component: NotFound },
    ],
  },
  { path: "*", Component: NotFound },
]);
export default function App() {
  return (
    <DemoProvider>
      <RouterProvider router={router} />
    </DemoProvider>
  );
}
