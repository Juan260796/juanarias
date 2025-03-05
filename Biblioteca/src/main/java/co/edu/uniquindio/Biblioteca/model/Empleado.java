package co.edu.uniquindio.Biblioteca.model;

public class Empleado {
    private String nombre;
    private String idEmpleado;

    public Empleado(){

    }
        public Empleado(String nombre, String idEmpleado){
        this.nombre= nombre;
        this.idEmpleado= idEmpleado;
    }

    public String getNombre(){
        return nombre;

    }

    public void setNombre(String nombre){
        this.nombre= nombre;
    }

    public String getIdeEmpleado(){
        return idEmpleado;

    }

    public void setIdEmpleado(String idEmpleado){
        this.idEmpleado= idEmpleado;

    }

}
