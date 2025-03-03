package co.edu.uniquindio.Biblioteca.model;

public class Empleado {
    private String nombre;
    private int idEmpleado;

    public Empleado(){

    }
        public Empleado(String nombre, int idEmpleado){
        this.nombre= nombre;
        this.idEmpleado= idEmpleado;
    }

    public String getNombre(){
        return nombre;

    }

    public void setNombre(String nombre){
        this.nombre= nombre;
    }

    public int setIdeEmpleado(){
        return idEmpleado;

    }

    public void getIdEmpleado(int idEmpleado){
        this.idEmpleado= idEmpleado;

    }

    interface GestionInventario{
        void gestionarItem (Libro libro);

    }

}
