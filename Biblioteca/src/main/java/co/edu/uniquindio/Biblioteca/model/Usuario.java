package co.edu.uniquindio.Biblioteca.model;

import java.util.List;
import java.util.ArrayList;

public class Usuario {
    private String nombre;
    private String idUsuario;
    private List<Prestamo> prestamosActivos;

    public Usuario(){

    }

        public Usuario(String nombre, String idUsuario){
        this.nombre= nombre;
        this.idUsuario= idUsuario;
        this.prestamosActivos= new ArrayList<>();
        }

        public String getNombre(){
        return nombre;

        }

        public void setNombre(String nombre){
        this.nombre= nombre;

        }

        public String getIdUsuario(){
        return idUsuario;

        }

        public void setIdUsuario(String idUsuario){
        this.idUsuario= idUsuario;

        }

        public List<Prestamo> getPrestamosActivos(){
        return prestamosActivos;

        }

        public void agregarPrestamo(Prestamo prestamo) {
        this.prestamosActivos.add(prestamo);

        }


    @Override
        public String toString() {
        return "Usuario{" +
                " nombre='" + nombre + '\'' +
                ", IdUsuario='" + idUsuario + '\''+
                ", prestamos activos='" + prestamosActivos + '}';
        }



}

