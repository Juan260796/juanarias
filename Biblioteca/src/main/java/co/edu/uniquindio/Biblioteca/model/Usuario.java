package co.edu.uniquindio.Biblioteca.model;

import java.util.List;
import java.util.ArrayList;

public class Usuario {
    private String nombre;
    private int idUsuario;

    public Usuario(){

    }

        public Usuario(String nombre, int idUsuario){
        this.nombre= nombre;
        this.idUsuario= idUsuario;
        }

        public String getNombre(){
        return nombre;

        }

        public void setNombre(String nombre){
        this.nombre= nombre;

        }

        public int getIdUsuario(){
        return idUsuario;

        }

        public void setIdUsuario(int idUsuario){

        this.idUsuario= idUsuario;
        }

        @Override
        public String toString() {
        return "Usuario: " + nombre + ", Idetificacion: " + idUsuario;
    }



}

